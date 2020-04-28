const path = require('path');
const mockFs = require('mock-fs');
const { silent } = require('resolve-from');
const { deduplicate } = require('../index');

jest.mock('../utils');

const mockResource = ({ filename, context }) => {
    return {
        request: filename,
        context,
    };
};

jest.mock('resolve-from', () => ({
    silent: jest.fn(),
}));
jest.mock('find-package-json', () => jest.fn());

describe('duplicate-transitive-replacement', () => {
    afterEach(() => mockFs.restore());

    it('duplicate transitive dependencies replacement - matching duplicates should return replaced request', () => {
        mockFs({
            [path.resolve(
                'node_modules/@atlaskit/bar/node_modules/@atlaskit/foo',
                './something'
            )]: 'stuff',
            [path.resolve(
                'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo',
                './something'
            )]: 'stuff',
            [path.resolve(
                'node_modules/@atlaskit/auh/node_modules/@atlaskit/bar',
                './something'
            )]: 'stuff',
        });
        const duplicates = [
            [
                '@atlaskit/foo',
                [
                    'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo',
                    'node_modules/@atlaskit/bar/node_modules/@atlaskit/foo',
                ],
            ],
        ];

        const matchingBarResource = mockResource({
            filename: './something',
            context: path.resolve('node_modules/@atlaskit/bar/node_modules/@atlaskit/foo'),
        });
        const matchingZooResource = mockResource({
            filename: './something',
            context: path.resolve('node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo'),
        });

        silent.mockImplementation((context) => {
            if (context === matchingBarResource.context) {
                return path.resolve(matchingBarResource.context, matchingBarResource.request);
            } else if (context === matchingZooResource.context) {
                return path.resolve(matchingZooResource.context, matchingZooResource.request);
            }
        });

        const finder = require('find-package-json');

        finder.mockImplementation(() => ({
            next: () => ({ value: { name: '@atlaskit/foo' } }),
        }));

        const previousLock = {};
        const currentLock = {};
        const barRes = deduplicate(matchingBarResource, duplicates, previousLock, currentLock);
        const zooRes = deduplicate(matchingZooResource, duplicates, previousLock, currentLock);

        // Don't replace bar
        expect(barRes).toEqual(undefined);
        // Replace zoo with bar
        expect(zooRes).toEqual(
            mockResource({
                filename: path.resolve(
                    'node_modules/@atlaskit/bar/node_modules/@atlaskit/foo/something'
                ),
                context: path.resolve('node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo'),
            })
        );
        // Generated a lock
        expect(currentLock).toEqual({
            '@atlaskit/foo': 'node_modules/@atlaskit/bar/node_modules/@atlaskit/foo',
        });
    });

    it('duplicate transitive dependencies replacement - use lock file', () => {
        mockFs({
            [path.resolve(
                'node_modules/@atlaskit/bar/node_modules/@atlaskit/foo',
                './something'
            )]: 'stuff',
            [path.resolve(
                'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo',
                './something'
            )]: 'stuff',
        });
        const duplicates = [
            [
                '@atlaskit/foo',
                [
                    'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo',
                    'node_modules/@atlaskit/bar/node_modules/@atlaskit/foo',
                ],
            ],
        ];

        const matchingBarResource = mockResource({
            filename: './something',
            context: path.resolve('node_modules/@atlaskit/bar/node_modules/@atlaskit/foo'),
        });
        const matchingZooResource = mockResource({
            filename: './something',
            context: path.resolve('node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo'),
        });

        silent.mockImplementation((context) => {
            if (context === matchingBarResource.context) {
                return path.resolve(matchingBarResource.context, matchingBarResource.request);
            } else if (context === matchingZooResource.context) {
                return path.resolve(matchingZooResource.context, matchingZooResource.request);
            }
        });

        const finder = require('find-package-json');

        finder.mockImplementation(() => ({
            next: () => ({ value: { name: '@atlaskit/foo' } }),
        }));

        const previousLock = {
            '@atlaskit/foo': 'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo',
        };
        const currentLock = {};
        const barRes = deduplicate(matchingBarResource, duplicates, previousLock, currentLock);
        const zooRes = deduplicate(matchingZooResource, duplicates, previousLock, currentLock);

        // Replaced bar with zoo because the lock says foo should map to zoo/foo
        expect(barRes).toEqual(
            mockResource({
                filename: path.resolve(
                    'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo/something'
                ),
                context: path.resolve('node_modules/@atlaskit/bar/node_modules/@atlaskit/foo'),
            })
        );
        // Should not touch zoo
        expect(zooRes).toEqual(undefined);
        // Generated a lock
        expect(currentLock).toEqual({
            '@atlaskit/foo': 'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo',
        });
    });

    it('duplicate transitive dependencies replacement - non-matching duplicates should return undefined', () => {
        mockFs({
            [path.resolve(
                'node_modules/@atlaskit/bar/node_modules/@atlaskit/foo',
                './something'
            )]: 'stuff',
            [path.resolve(
                'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo',
                './something'
            )]: 'stuff',
            [path.resolve(
                'node_modules/@atlaskit/auh/node_modules/@atlaskit/bar',
                './something'
            )]: 'stuff',
        });
        const duplicates = [
            [
                '@atlaskit/foo',
                [
                    'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo',
                    'node_modules/@atlaskit/bar/node_modules/@atlaskit/foo',
                ],
            ],
        ];

        const nonMatchingResource = mockResource({
            filename: './something',
            context: path.resolve('node_modules/@atlaskit/auh/node_modules/@atlaskit/foo'),
        });

        silent.mockImplementation(() =>
            path.resolve(nonMatchingResource.context, nonMatchingResource.request)
        );

        const finder = require('find-package-json');

        finder.mockImplementation(() => ({
            next: () => ({ value: { name: '@atlaskit/foo' } }),
        }));

        const previousLock = {};
        const currentLock = {};
        const res = deduplicate(nonMatchingResource, duplicates, previousLock, currentLock);

        expect(res).toEqual(undefined);
    });
});
