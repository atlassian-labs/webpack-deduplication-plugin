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

const findBestMatch = (key, prefixGroup, previousLock, currentLock, resolvedResource) => {
    for (const prefix of prefixGroup) {
        if (resolvedResource.includes(prefix)) {
            // If we have a lock file. Always use the entry saved previously to achieve the long term caching.
            if (key in previousLock) {
                currentLock[key] = prefixGroup.find((prefix) => prefix.includes(previousLock[key]));
            }

            // Don't replace on the first encounter but assign the found prefix to the group.
            // Next time if we found a prefix match we use the assigned result from previous iterations.
            if (key in currentLock) {
                return [prefix, currentLock[key]];
            } else {
                currentLock[key] = prefix;
                return null;
            }
        }
    }
    return null;
};

const deduplicate = (result, prefixGroups, previousLock, currentLock) => {
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
    const wasChanged = prefixGroups.some(([key, prefixGroup]) => {
        const found = findBestMatch(key, prefixGroup, previousLock, currentLock, resolvedResource);

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
};

const PLUGIN_NAME = 'WebpackDeduplicationPlugin';

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

        const prefixGroups = Object.entries(duplicates);
        const previousLock = getDedupLock(this.rootPath);
        const currentLock = {};

        compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, (nmf) => {
            nmf.hooks.beforeResolve.tap(PLUGIN_NAME, (result) => {
                return deduplicate(result, prefixGroups, previousLock, currentLock);
            });
        });

        compiler.hooks.afterCompile.tap(PLUGIN_NAME, () => {
            writeDedupLock(this.rootPath, currentLock);
        });
    }
}

module.exports = {
    WebpackDeduplicationPlugin,
    deduplicate,
};
