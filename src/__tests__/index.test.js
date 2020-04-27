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
                'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo',
                'node_modules/@atlaskit/bar/node_modules/@atlaskit/foo',
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

        const barRes = deduplicate(matchingBarResource, duplicates);
        const zooRes = deduplicate(matchingZooResource, duplicates);

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
                'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo',
                'node_modules/@atlaskit/bar/node_modules/@atlaskit/foo',
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

        const res = deduplicate(nonMatchingResource, duplicates);

        expect(res).toEqual(undefined);
    });
});
