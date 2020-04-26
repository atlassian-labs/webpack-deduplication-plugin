import browserResolve from 'browser-resolve';
import packageJsonFinder from 'find-package-json';
import memoize from 'lodash/memoize';
import resolveFrom from 'resolve-from';

import { getDuplicatedPackages } from './utils';

const resolved = memoize(
    (request, context) => {
        try {
            const browserResolvedModule = browserResolve.sync(request, {
                basedir: context,
                browser: 'module',
            });
            return browserResolve.sync(browserResolvedModule, {
                filename: browserResolvedModule,
            });
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
        const indexFirstNodeModule = resolvedDup.indexOf('node_modules');
        const replacedModuleIndex = resolvedDup.indexOf(replaceWithFirst);

        if (indexFirstNodeModule !== replacedModuleIndex) {
            return false;
        }

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
    constructor({ cacheDir }) {
        this.cacheDir = cacheDir;
    }

    apply(compiler) {
        const { cacheDir } = this;
        const duplicates = getDuplicatedPackages({
            cacheDir,
        });

        const dupVals = Object.values(duplicates);

        compiler.hooks.normalModuleFactory.tap('WebpackDeduplicationPlugin', (nmf) => {
            nmf.hooks.beforeResolve.tap('WebpackDeduplicationPlugin', (result) => {
                return deduplicate(result, dupVals);
            });
        });
    }
}

export { WebpackDeduplicationPlugin, deduplicate };
