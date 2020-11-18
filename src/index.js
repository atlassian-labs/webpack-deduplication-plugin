const fs = require('fs');
const browserResolve = require('browser-resolve');
const packageJsonFinder = require('find-package-json');
const memoize = require('lodash/memoize');
const resolveFrom = require('resolve-from');

const { getDuplicatedPackages } = require('./utils');

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

const findDuplicate = (res) => (t) => {
    return res.includes(t + '/');
};

const findBestMatch = (arr, matcher) => {
    return arr.filter(matcher).sort((a, b) => b.length - a.length)[0];
};

const deduplicate = (result, dupVals) => {
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
    const wasChanged = dupVals.some((onePackageDuplicates) => {
        const found = findBestMatch(onePackageDuplicates, findDuplicate(resolvedResource));

        if (!found) {
            return false;
        }

        const replaceWithFirst = onePackageDuplicates[0];
        const resolvedDup = resolvedResource.replace(found, replaceWithFirst);

        const lastIndex = resolvedDup.indexOf(
            'node_modules',
            resolvedDup.indexOf(replaceWithFirst) + replaceWithFirst.length
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
};

class WebpackDeduplicationPlugin {
    constructor({ cacheDir, rootPath }) {
        this.cacheDir = cacheDir;
        this.rootPath = rootPath;
    }

    apply(compiler) {
        const { cacheDir, rootPath } = this;
        const duplicates = getDuplicatedPackages({
            cacheDir,
            rootPath,
        });

        const dupVals = Object.values(duplicates);

        compiler.hooks.normalModuleFactory.tap('WebpackDeduplicationPlugin', (nmf) => {
            nmf.hooks.beforeResolve.tap('WebpackDeduplicationPlugin', (result) => {
                return deduplicate(result, dupVals);
            });
        });
    }
}

module.exports = {
    WebpackDeduplicationPlugin,
    deduplicate,
};
