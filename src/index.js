const path = require('path');
const browserResolve = require('browser-resolve');
const packageJsonFinder = require('find-package-json');
const memoize = require('lodash/memoize');
const resolveFrom = require('resolve-from');

const { getDedupLock, writeDedupLock, getDuplicatedPackages } = require('./utils');

const resolved = memoize(
    (request, context) => {
        try {
            const browserResolvedModule = browserResolve.sync(request, {
                basedir: context,
                browser: 'module',
            });
            return browserResolve.sync(browserResolvedModule, { filename: browserResolvedModule });
        } catch (e) {
            return resolveFrom.silent(context, request);
        }
    },
    (r, c) => `${r} _____ ${c}`
);

const containsNodeModules = (resolvedResource) => {
    return resolvedResource.includes('node_modules');
};

class DeDuplicator {
    constructor({ existingLock }) {
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

    deduplicate(result, duplicateEntries) {
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
        const wasChanged = duplicateEntries.some(([key, duplicates]) => {
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
        this.lockFilePath = lockFilePath || path.join(rootPath, 'webpack-dedup.lock');
    }

    apply(compiler) {
        const { cacheDir, rootPath } = this;
        const duplicates = getDuplicatedPackages({
            cacheDir,
            rootPath,
        });

        const duplicateEntries = Object.entries(duplicates);
        const deDuplicator = new DeDuplicator({ existingLock: getDedupLock(this.lockFilePath) });

        compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, (nmf) => {
            nmf.hooks.beforeResolve.tap(PLUGIN_NAME, (result) => {
                return deDuplicator.deduplicate(result, duplicateEntries);
            });
        });

        compiler.hooks.emit.tap(PLUGIN_NAME, () => {
            writeDedupLock(this.lockFilePath, this.rootPath, deDuplicator.getLock());
        });
    }
}

module.exports = {
    WebpackDeduplicationPlugin,
    DeDuplicator,
};
