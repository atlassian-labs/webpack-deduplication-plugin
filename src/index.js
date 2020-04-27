const browserResolve = require('browser-resolve');
const packageJsonFinder = require('find-package-json');
const memoize = require('lodash/memoize');
const resolveFrom = require('resolve-from');

const { getDuplicatedPackages } = require('./utils');

// eslint-disable-next-line no-undef
const prefixGroupAssignmentMap = new Map();

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

const findBestMatch = (prefixGroup, fullPath) => {
    for (const prefix of prefixGroup) {
        if (fullPath.includes(prefix)) {
            // Don't replace on the first encounter but assign the found prefix to the group.
            // Next time if we found a prefix match we use the assigned result from previous iterations.
            if (prefixGroupAssignmentMap.has(prefixGroup)) {
                return [prefix, prefixGroupAssignmentMap.get(prefixGroup)];
            } else {
                prefixGroupAssignmentMap.set(prefixGroup, prefix);
                return null;
            }
        }
    }
    return null;
};

const deduplicate = (result, prefixGroups) => {
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
    const wasChanged = prefixGroups.some((prefixGroup) => {
        const found = findBestMatch(prefixGroup, resolvedResource);

        if (!found) {
            return false;
        }

        const [search, replacement] = found;
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

        const prefixGroups = Object.values(duplicates);

        compiler.hooks.normalModuleFactory.tap('WebpackDeduplicationPlugin', (nmf) => {
            nmf.hooks.beforeResolve.tap('WebpackDeduplicationPlugin', (result) => {
                return deduplicate(result, prefixGroups);
            });
        });
    }
}

module.exports = {
    WebpackDeduplicationPlugin,
    deduplicate,
};
