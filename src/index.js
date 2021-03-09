const path = require('path');
const packageJsonFinder = require('find-package-json');

const { createMemoisedResolver } = require('./resolver');
const { getDuplicatedPackages } = require('./utils');

const containsNodeModules = (resolvedResource) => {
    return resolvedResource.includes('node_modules');
};

const findDuplicate = (resolvedResource) => (duplicate) => {
    // prevent partial name matches. I.e. don't match `/button` when resolving `/button-group`
    const duplicateDir = `${duplicate}${path.sep}`;
    return resolvedResource.includes(duplicateDir);
};

const findBestMatch = (arr, matcher) => {
    return arr.filter(matcher).sort((a, b) => b.length - a.length)[0];
};

const deduplicate = (result, dupVals, resolver) => {
    // Note that the "API" for a beforeResolve hook is to return `undefined` to continue,
    // or `false` to skip this dependency. So we pretty much always return `undefined`.

    if (!result) return undefined;

    // dont touch loaders
    if (result.request.startsWith('!')) {
        return undefined;
    }

    const resolvedResource = resolver(result.request, result.context);
    if (!resolvedResource) {
        return undefined;
    }

    // short circuit
    if (!containsNodeModules(resolvedResource)) {
        return undefined;
    }

    // we will change result as a side-effect
    dupVals.some((onePackageDuplicates) => {
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

        const resolver = createMemoisedResolver(compiler.options.resolve.mainFields);

        const dupVals = Object.values(duplicates);
        compiler.hooks.normalModuleFactory.tap('WebpackDeduplicationPlugin', (nmf) => {
            nmf.hooks.beforeResolve.tap('WebpackDeduplicationPlugin', (result) => {
                return deduplicate(result, dupVals, resolver);
            });
        });
    }
}

module.exports = {
    WebpackDeduplicationPlugin,
    deduplicate,
};
