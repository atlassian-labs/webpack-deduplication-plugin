const fs = require('fs');
const mockFs = require('mock-fs');

const { getDuplicatedPackages, extractPackageName } = require('./utils');

const nodeModulesPrefix = 'node_modules/something/node_modules';

const nodeModulesMock = {
    'yarn.lock': 'this has stuff in it',
    // we expect this to be handled by Yarn, so explicitly excluding root level node_modules from the check
    node_modules: {
        'package-a-root-duplicate': {
            'package.json': `{
                      "name": "package-a",
                      "version": "0.1.0",
                      "dependencies": {
                        "package-d": "1.0.1"
                      }
                    }`,
        },
    },
    [nodeModulesPrefix]: {
        'package-a': {
            'package.json': `{
                      "name": "package-a",
                      "version": "0.1.0",
                      "dependencies": {
                        "package-d": "1.0.1"
                      }
                    }`,
        },
        'package-a-duplicate': {
            'package.json': `{
                      "name": "package-a",
                      "version": "0.1.0",
                      "dependencies": {
                        "package-d": "1.0.1"
                      }
                    }`,
        },
        'package-a-different-version': {
            'package.json': `{
                      "name": "package-a",
                      "version": "0.1.1",
                      "dependencies": {
                        "package-d": "1.0.1"
                      }
                    }`,
        },
        'package-b-standalone': {
            'package.json': `{
                      "name": "package-b",
                      "version": "0.1.0",
                      "dependencies": {
                        "package-d": "1.0.1"
                      }
                    }`,
        },
        'package-c-not-valid': {
            'package.json': `{
                      "name": "package-a",
                      "version": "0.1.0",
                    }`,
        },
        'package-d': {
            'package.json': `{
                      "name": "package-d",
                      "version": "0.1.0",
                      "dependencies": {
                        "package-d": "1.0.1"
                      }
                    }`,
        },
        'package-d-duplicate': {
            'package.json': `{
                      "name": "package-d",
                      "version": "0.1.0",
                      "dependencies": {
                        "package-d": "1.0.1"
                      }
                    }`,
        },
    },
};

describe('deduplicate transitive dependenices plugin', () => {
    beforeEach(() => {
        jest.resetModules();

        mockFs({
            ...nodeModulesMock,
            patches: {},
        });
    });

    afterEach(() => {
        mockFs.restore();
    });

    it('should find duplicated packages', () => {
        const duplicates = getDuplicatedPackages();

        expect(duplicates).toEqual({
            'package-a@0.1.0': [
                `${nodeModulesPrefix}/package-a`,
                `${nodeModulesPrefix}/package-a-duplicate`,
            ],
            'package-d@0.1.0': [
                `${nodeModulesPrefix}/package-d`,
                `${nodeModulesPrefix}/package-d-duplicate`,
            ],
        });
    });

    it('should use cached result if deps have not changed', () => {
        const one = getDuplicatedPackages({
            cacheDir: '/cache',
        });
        const two = getDuplicatedPackages({
            cacheDir: '/cache',
        });

        expect(one).toEqual(two);
        // The best we can do without digging into internals is to make sure a cache entry was
        // created
        const cacheEntries = fs
            .readdirSync('/cache')
            .filter((filename) => /^duplicates-.*\.json$/.test(filename));
        expect(cacheEntries).toHaveLength(1);
    });

    it('should invalidate cache if yarn.lock changes', () => {
        const one = getDuplicatedPackages({
            cacheDir: '/cache',
        });
        fs.writeFileSync('yarn.lock', 'different content', 'utf8');
        const two = getDuplicatedPackages({
            cacheDir: '/cache',
        });

        expect(one).toEqual(two);
        // The best we can do without digging into internals is to make sure a cache entry was
        // created
        const cacheEntries = fs
            .readdirSync('/cache')
            .filter((filename) => /^duplicates-.*\.json$/.test(filename));
        expect(cacheEntries).toHaveLength(2);
    });

    it('should invalidate cache if patches list changes', () => {
        getDuplicatedPackages({
            cacheDir: '/cache',
        });
        fs.writeFileSync('patches/package-a+0.1.0.patch', 'whatever', 'utf8');
        const two = getDuplicatedPackages({
            cacheDir: '/cache',
        });
        const three = getDuplicatedPackages({
            cacheDir: '/cache',
        });
        expect(two).toEqual(three);

        // The best we can do without digging into internals is to make sure a cache entry was
        // created
        const cacheEntries = fs
            .readdirSync('/cache')
            .filter((filename) => /^duplicates-.*\.json$/.test(filename));
        expect(cacheEntries).toHaveLength(2);
    });

    it('should exclude patches', () => {
        mockFs({
            ...nodeModulesMock,
            patches: {
                'package-a+0.1.0.patch': '',
            },
        });
        const duplicates = getDuplicatedPackages();

        expect(duplicates).toEqual({
            'package-d@0.1.0': [
                `${nodeModulesPrefix}/package-d`,
                `${nodeModulesPrefix}/package-d-duplicate`,
            ],
        });
    });

    it('should extract correct names from patches', () => {
        const patches = {
            'eslint-plugin-formatjs+1.5.4.patch': 'eslint-plugin-formatjs@1.5.4',
            '@atlaskit+blanket+10.0.16.patch': '@atlaskit/blanket@10.0.16',
            '@atlaskit+blanket++@atlaskit+analytics-next+6.3.4.patch':
                '@atlaskit/analytics-next@6.3.4',
        };

        Object.entries(patches).forEach(([patch, pkg]) => {
            expect(extractPackageName(patch, '')).toEqual(pkg);
        });

        expect(extractPackageName('analytics-web-client+1.10.0.patch', '@atlassiansox')).toEqual(
            '@atlassiansox/analytics-web-client@1.10.0'
        );
    });
});
