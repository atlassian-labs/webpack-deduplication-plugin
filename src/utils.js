const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const appRoot = require('app-root-path');
const glob = require('fast-glob');
const flatten = require('lodash/flatten');
const isEqual = require('lodash/isEqual');
const pickBy = require('lodash/pickBy');
const transform = require('lodash/transform');
const mkdirp = require('mkdirp');

const patchesPath = 'patches';

const extractPackageName = (name, scope) => {
    const patchName = scope ? `${scope}+${name}` : name;
    const patchArr = patchName.split('++');
    // we care about only the last package name, this is the one that is duplicated/patched
    // the rest from the path, if it exists, is the "parent" packages
    const lastPkg = patchArr[patchArr.length - 1].replace('.patch', '').split('+');

    // taking care of the scoped and non-scoped packages
    return lastPkg.length === 2
        ? `${lastPkg[0]}@${lastPkg[1]}`
        : `${lastPkg[0]}/${lastPkg[1]}@${lastPkg[2]}`;
};

const getListOfPackages = (list, root, scope) => {
    return flatten(
        list.map((item) => {
            const itemPath = path.resolve(root, item);
            if (fs.lstatSync(itemPath).isFile()) {
                return extractPackageName(item, scope);
            }
            const innerList = fs.readdirSync(itemPath);

            return getListOfPackages(innerList, itemPath, item);
        })
    );
};

const getPatchedPackages = (pPath) => {
    if (!fs.existsSync(pPath)) {
        return [];
    }
    const list = fs.readdirSync(pPath);

    return getListOfPackages(list, pPath);
};

const extractProperDuplicates = (duplicates) => {
    return duplicates.filter((dup) => {
        const firstDupFilepath = path.resolve(duplicates[0], 'package.json');
        const dupFilepath = path.resolve(dup, 'package.json');
        const firstDupJson = JSON.parse(fs.readFileSync(firstDupFilepath).toString());
        const dupJson = JSON.parse(fs.readFileSync(dupFilepath).toString());

        return isEqual(firstDupJson, dupJson);
    });
};

const getCacheKey = ({ patchedPackages, rootPath }) => {
    const yarnLock = fs.readFileSync(path.resolve(rootPath, 'yarn.lock'));
    const hash = crypto.createHash('md5');
    hash.update(yarnLock);
    hash.update(patchedPackages.join(','));
    return hash.digest('hex');
};

// node_modules/**/node_modules/**/package.json pattern is a duplicate, we don't really need root-level packages
const filterOnlyDuplicates = (pkg) =>
    pkg.split(path.sep).filter((p) => p === 'node_modules').length > 1;

const CACHE_BUST = 1;

const getDuplicatedPackages = (options = {}) => {
    const rootPath = options.rootPath || appRoot.toString();
    const patchedPackages = getPatchedPackages(options.patchesPath || patchesPath);
    let cacheFileName;
    if (options.cacheDir) {
        mkdirp.sync(options.cacheDir);
        const cacheKey = getCacheKey({ rootPath, patchedPackages });
        cacheFileName = path.resolve(options.cacheDir, `duplicates-${cacheKey}.${CACHE_BUST}.json`);
        if (fs.existsSync(cacheFileName)) {
            return JSON.parse(fs.readFileSync(cacheFileName, 'utf8'));
        }
    }

    const packages = glob
        .sync(`${rootPath}/node_modules/**/package.json`)
        .sort()
        .filter(filterOnlyDuplicates);

    const packageJsonsByKeyFull = {};

    packages.forEach((p) => {
        let json = {};

        try {
            json = JSON.parse(fs.readFileSync(path.resolve(p)).toString());
        } catch (e) {
            // console && console.error && console.error('Something went wrong while parsing package.json', p, e);
        }

        const { name, version, dependencies } = json;

        // check whether it's a "proper" package, you'd be surprised how many weird `package.json` out there
        if (name && version && dependencies) {
            const depName = `${name}@${version}`;

            packageJsonsByKeyFull[depName] = packageJsonsByKeyFull[depName] || [];
            packageJsonsByKeyFull[depName].push(path.parse(p).dir);
        }
    });

    const onlyDuplicates = pickBy(packageJsonsByKeyFull, (value, key) => {
        return value.length > 1 && !patchedPackages.includes(key);
    });

    const cleanFromFalsePositives = transform(
        onlyDuplicates,
        (result, value, key) => {
            // eslint-disable-next-line no-param-reassign
            result[key] = extractProperDuplicates(value).sort();
        },
        {}
    );

    if (cacheFileName) {
        fs.writeFileSync(cacheFileName, JSON.stringify(cleanFromFalsePositives, null, 2), 'utf8');
    }

    return cleanFromFalsePositives;
};

module.exports = {
    getDuplicatedPackages,
    extractPackageName,
    getListOfPackages,
};
