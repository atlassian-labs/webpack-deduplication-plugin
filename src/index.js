const browserResolve = require('browser-resolve');
const packageJsonFinder = require('find-package-json');
const memoize = require('lodash/memoize');
const resolveFrom = require('resolve-from');

const { getDuplicatedPackages } = require('./utils');

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

const findDuplicate = (res) => (t) => {
    return res.includes(t);
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
