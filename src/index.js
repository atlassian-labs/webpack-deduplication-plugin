const path = require('path');
const fs = require('fs');
const packageJsonFinder = require('find-package-json');

const {createMemoisedResolver} = require('./resolver');
const {getDuplicatedPackages} = require('./utils');
const {buildSearchTrie, searchTrie} = require('./trie');
const {readPackageName} = require('./package-utils');

const containsNodeModules = (resolvedResource) => {
    return resolvedResource.includes('node_modules');
};

const {sep} = path;

const findDuplicate = (resolvedResource) => (duplicate) => {
    // prevent partial name matches. I.e. don't match `/button` when resolving `/button-group`
    const duplicateDir = `${duplicate}${path.sep}`;
    return resolvedResource.includes(duplicateDir);
};

const findBestMatch = (arr, matcher) => {
    return arr.filter(matcher).sort((a, b) => b.length - a.length)[0];
};

const getPackageName = function (trie, location) {
    const {path: packageLocation} = searchTrie(trie, location, sep);
    // trie contains package.json locations. Just look for one
    return readPackageName(packageLocation);
};

const oldSearch = (dupVals, resolvedResource) => {
    for(const onePackageDuplicates of dupVals) {
        const found = findBestMatch(onePackageDuplicates, findDuplicate(resolvedResource));

        if (!found) {
            continue;
        }

        const replaceWithFirst = onePackageDuplicates[0];
        const resolvedDup = resolvedResource.replace(found, replaceWithFirst);

        const lastIndex = resolvedDup.indexOf(
            'node_modules',
            resolvedDup.indexOf(replaceWithFirst) + replaceWithFirst.length
        );

        if (lastIndex !== -1) {
            continue;
        }

        const resolvedBase = packageJsonFinder(resolvedDup).next().value;
        const resolvedResourceBase = packageJsonFinder(resolvedResource).next().value;

        if (resolvedBase.version !== resolvedResourceBase.version) {
            console.error('ooof');
            throw new Error('package version mismatch')
        }

        if(resolvedResource===resolvedDup){
            return undefined;
        }

        return resolvedDup;
    };
}

const newSearch = (trie, resolvedResource) => {
    const { value: replaceWithFirst, path: found } = searchTrie(trie, resolvedResource, sep);

    // found record in trie, and it's not already optimal
    // however it's guaranteed to be "maximal"
    if (!replaceWithFirst || found === replaceWithFirst) {
        return undefined;
    }

    const resolvedDup = resolvedResource.replace(found, replaceWithFirst)
    const lastIndex = resolvedDup.indexOf(
        'node_modules',
        replaceWithFirst.length
    );

    if (lastIndex !== -1) {
        return undefined;
    }
    // replacing path by alias
    return resolvedDup;
}

const deduplicate = (result, dupVals, trie, resolver, replacements) => {
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

    const v1 = oldSearch(dupVals, resolvedResource);
    const v2 = newSearch(trie, resolvedResource);

    if(v1!==v2){
        console.error('mismatch', resolvedResource,v1,v2)
        throw new Error(`${resolvedResource}: ${v1} -> ${v2}`)
    }
    if(v2){
        // replacements[resolvedResource] = v2;
        result.request = v1;
    }

    return undefined;
};

/**
 * creates a search trie in form of [path]->[shortest variant]
 */
const prepareDuplicationDictionary = (duplicates) => {
    const load = [];
    duplicates.forEach((candidates) => {
        const bestChoice = candidates[0];
        candidates.forEach((packagePath) => {
            load.push([packagePath, bestChoice]);
        });
    });
    return buildSearchTrie(load, sep);
};

class WebpackDeduplicationPlugin {
    constructor({cacheDir, rootPath}) {
        this.cacheDir = cacheDir;
        this.rootPath = rootPath;
    }

    apply(compiler) {
        const {cacheDir, rootPath} = this;
        const duplicates = getDuplicatedPackages({
            cacheDir,
            rootPath,
        });

        const resolver = createMemoisedResolver(compiler.options.resolve.mainFields);

        const dupVals = Object.values(duplicates);
        const trie = prepareDuplicationDictionary(dupVals);

        const replacements = {};
        compiler.hooks.normalModuleFactory.tap('WebpackDeduplicationPlugin', (nmf) => {
            nmf.hooks.beforeResolve.tap('WebpackDeduplicationPlugin', (result) => {
                const answer = deduplicate(result, dupVals, trie, resolver, replacements);
                return answer;
            });
        });

        compiler.hooks.done.tap('WebpackDeduplicationPlugin', () => {
            console.log('saving stash');
            // fs.writeFileSync(path.join(cacheDir, 'resolved.json'), JSON.stringify(replacements, null, 2));
        })
    }
}

module.exports = {
    WebpackDeduplicationPlugin,
    deduplicate,
};
