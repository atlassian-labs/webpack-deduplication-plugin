const fs = require('fs');
const path = require('path');
const browserResolve = require('browser-resolve');
const packageJsonFinder = require('find-package-json');
const memoize = require('lodash/memoize');
const resolveFrom = require('resolve-from');

const { getDedupLock, writeDedupLock, getDuplicatedPackages } = require('./utils');

const noop = () => {};

// This is a small perf optimisation - `resolve` which is used by `browser-resolve`
// takes an optional `isFile` function. So we provide a memoized equivalent of what the
// `resolve` module has internally. This improves perf by about 15% in a benchmark run of
// ~25K resolutions.
const memoizedIsFileSync = memoize(function (file) {
    let stat;
    try {
        stat = fs.statSync(file);
    } catch (err) {
        if (err && err.code === 'ENOENT') return false;
    }
    return stat.isFile() || stat.isFIFO();
});

const resolved = memoize(
    (request, context) => {
        let resolved;

        // This is a bit of a performance hack. The short of it is that the way to checks for the
        // existence of a file in Node is by performing an fs operation (whether that's a `read`
        // or a `stat`). When this operation fails, an exception is created and thrown. Checking
        // the underlying OS error type in this exception can be used to determine whether the file
        // exists or some other error occurred.
        //
        // Node does this through an internal method called `uvException` - https://github.com/nodejs/node/blob/307c67be175b8fe7d9dd9e1b5ed55d928b73d66d/lib/internal/errors.js#L399
        // (`libuv` being the underlying library that handles Node's async i/o). These exceptions
        // have a full stacktrace generated, which is actually a super expensive operation. Now
        // when we call `resolve` 20,000+ times during a webpack build we're generating a lot of
        // exceptions with stack traces that we just end up throwing away.
        //
        // So this hack noops the `captureStackTrace` method Node uses, and cuts the stack limit for
        // `new Error` calls. This means that errors occurring in this function won't have stack
        // traces, but this is an acceptable tradeoff for the almost 50% perf improvement we get
        // when we have a compile of significant size.
        //
        // A profile still shows significant time in `uvException`, but there aren't any extra obvious
        // easy optimisation opportunities.
        const originalCaptureStackTrace = Error.captureStackTrace;
        const originalStackLimit = Error.stackTraceLimit;
        try {
            Error.captureStackTrace = noop;
            Error.stackTraceLimit = 0;

            const browserResolvedModule = browserResolve.sync(request, {
                basedir: context,
                browser: 'module',
                isFile: memoizedIsFileSync,
            });
            resolved = browserResolve.sync(browserResolvedModule, {
                filename: browserResolvedModule,
                isFile: memoizedIsFileSync,
            });
        } catch (e) {
            resolved = resolveFrom.silent(context, request);
        } finally {
            Error.captureStackTrace = originalCaptureStackTrace;
            Error.stackTraceLimit = originalStackLimit;
        }
        return resolved;
    },
    (r, c) => `${r} _____ ${c}`
);

const containsNodeModules = (resolvedResource) => {
    return resolvedResource.includes('node_modules');
};

class DeDuplicator {
    constructor({ duplicates, existingLock }) {
        this.duplicateEntries = Object.entries(duplicates);
        this.existingLock = existingLock;
        this.newLock = {};
    }

    _findBestMatch(key, duplicates, resolvedResource) {
        for (const duplicate of duplicates) {
            if (resolvedResource.includes(duplicate)) {
                // If we have a lock file. Always use the entry saved previously to achieve the long term caching.
                if (key in this.existingLock) {
                    this.newLock[key] = duplicates.find((duplicate) =>
                        duplicate.includes(this.existingLock[key])
                    );
                }

                if (key in this.newLock) {
                    return [duplicate, this.newLock[key]];
                } else {
                    this.newLock[key] = duplicate;
                    return null;
                }
            }
        }
        return null;
    }

    getLock() {
        return this.newLock;
    }

    deduplicate(result) {
        if (!result) return undefined;

        // dont touch loaders
        if (result.request.startsWith('!')) {
            return undefined;
        }

        const resolvedResource = resolved(result.request, result.context);
        if (!resolvedResource) {
            return undefined;
        }

        // short circuit
        if (!containsNodeModules(resolvedResource)) {
            return undefined;
        }

        // we will change result as a side-effect
        const wasChanged = this.duplicateEntries.some(([key, duplicates]) => {
            const found = this._findBestMatch(key, duplicates, resolvedResource);

            if (!found) {
                return false;
            }

            const [search, replacement] = found;
            if (search === replacement) {
                return false;
            }

            const resolvedDup = resolvedResource.replace(search, replacement);

            const lastIndex = resolvedDup.indexOf(
                'node_modules',
                resolvedDup.indexOf(replacement) + replacement.length
            );

            if (lastIndex !== -1) {
                return false;
            }

            const resolvedBase = packageJsonFinder(resolvedDup).next().value.name;
            const resolvedResourceBase = packageJsonFinder(resolvedResource).next().value.name;
            if (resolvedBase !== resolvedResourceBase) {
                return false;
            }

            // this is how it works with webpack
            // eslint-disable-next-line no-param-reassign
            result.request = resolvedDup;
            return true;
        });

        if (wasChanged) {
            // conflicting eslint rules
            return result;
        }

        return undefined;
    }
}

const PLUGIN_NAME = 'WebpackDeduplicationPlugin';

class WebpackDeduplicationPlugin {
    constructor({ cacheDir, rootPath, lockFilePath }) {
        this.cacheDir = cacheDir;
        this.rootPath = rootPath;
        this.lockFilePath = lockFilePath || path.resolve(rootPath, 'webpack-dedup.lock');
    }

    apply(compiler) {
        const { cacheDir, rootPath } = this;
        const duplicates = getDuplicatedPackages({
            cacheDir,
            rootPath,
        });

        const { yarnLockHash, lock } = getDedupLock(this.lockFilePath);
        const deDuplicator = new DeDuplicator({
            duplicates,
            existingLock: lock,
        });

        compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, (nmf) => {
            nmf.hooks.beforeResolve.tap(PLUGIN_NAME, (result) => {
                return deDuplicator.deduplicate(result);
            });
        });

        compiler.hooks.emit.tap(PLUGIN_NAME, () => {
            writeDedupLock({
                previousYarnLockHash: yarnLockHash,
                lockFilePath: this.lockFilePath,
                root: this.rootPath,
                lock: deDuplicator.getLock(),
            });
        });
    }
}

module.exports = {
    WebpackDeduplicationPlugin,
    DeDuplicator,
};
