const fs = require('fs');
const { sep } = require('path');
const browserResolve = require('browser-resolve');
const memoize = require('lodash/memoize');
const resolveFrom = require('resolve-from');

const { readPackageName } = require('./package-utils');
const { buildSearchTrie, searchTrie } = require('./trie');
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

const getPackageName = function (trie, location) {
    const { path: packageLocation } = searchTrie(trie, location, sep);
    // trie contains package.json locations. Just look for one
    return readPackageName(packageLocation);
};

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

const deduplicateTrie = (result, trie) => {
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

    const { value: replaceWithFirst, path: found } = searchTrie(trie, resolvedResource, sep);

    // found record in trie, and it's not already optimal
    // however it's guaranteed to be "maximal"
    if (!replaceWithFirst || found === replaceWithFirst) {
        return undefined;
    }

    // replacing path by alias
    const resolvedDup = resolvedResource.replace(found, replaceWithFirst);

    // checking that new path and the old path are pointing to the same package
    // as long as entries in trie are derived from locations of `package.jsons`
    // using the same trie to find the last entry

    // TODO: this check might not be needed in optimistic mode. Not sure we need it at the build time
    const resolvedBase = getPackageName(trie, resolvedDup);
    const resolvedResourceBase = getPackageName(trie, resolvedResource);
    if (resolvedBase !== resolvedResourceBase) {
        return undefined;
    }

    // this is how it works with webpack
    // eslint-disable-next-line no-param-reassign
    result.request = resolvedDup;
    return result;
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

        const trie = prepareDuplicationDictionary(Object.values(duplicates));

        compiler.hooks.normalModuleFactory.tap('WebpackDeduplicationPlugin', (nmf) => {
            nmf.hooks.beforeResolve.tap('WebpackDeduplicationPlugin', (result) => {
                return deduplicateTrie(result, trie);
            });
        });
    }
}

function deduplicate(result, values) {
    return deduplicateTrie(result, prepareDuplicationDictionary(values));
}

module.exports = {
    WebpackDeduplicationPlugin,
    deduplicate,
};
