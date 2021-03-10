const path = require('path');
const mockFs = require('mock-fs');
const { deduplicate } = require('../index');

jest.mock('../utils');

const mockResource = ({ filename, context }) => {
    return {
        request: filename,
        context,
    };
};

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

        const matchingResource = mockResource({
            filename: './something',
            context: path.resolve('node_modules/@atlaskit/bar/node_modules/@atlaskit/foo'),
        });

        const finder = require('find-package-json');

        finder.mockImplementation(() => ({
            next: () => ({ value: { name: '@atlaskit/foo' } }),
        }));

        const resolver = () => path.resolve(matchingResource.context, matchingResource.request);

        deduplicate(matchingResource, duplicates, resolver);

        expect(matchingResource).toEqual(
            mockResource({
                filename: path.resolve(
                    'node_modules/@atlaskit/zoo/node_modules/@atlaskit/foo/something'
                ),
                context: path.resolve('node_modules/@atlaskit/bar/node_modules/@atlaskit/foo'),
            })
        );
    });

    it('should not deduplicate when package name is partial match', () => {
        mockFs({
            [path.resolve(
                'node_modules/@org/component-a/node_modules/@org/radio-button',
                './index.js'
            )]: 'some radio button code',

            [path.resolve(
                'node_modules/@org/component-b/node_modules/@org/radio-button',
                './index.js'
            )]: 'some radio button code',

            [path.resolve(
                'node_modules/@org/component-b/node_modules/@org/radio-button-group',
                './index.js'
            )]: 'some radio button GROUP code',
        });

        const duplicates = [
            // although duplicate packages are prefixed with 'radio-button', these should
            // be ignored as they are not a full match on the 'radio-button-group'
            [
                'node_modules/@org/component-a/node_modules/@org/radio-button',
                'node_modules/@org/component-b/node_modules/@org/radio-button',
            ],
        ];

        const matchingResource = mockResource({
            filename: './index.js',
            context: path.resolve(
                'node_modules/@org/component-b/node_modules/@org/radio-button-group'
            ),
        });

        const resolver = () => path.resolve(matchingResource.context, matchingResource.request);

        const finder = require('find-package-json');

        finder.mockImplementation(() => ({
            next: () => ({ value: { name: '@org/component-b' } }),
        }));

        deduplicate(matchingResource, duplicates, resolver);

        expect(matchingResource.context).not.toContain(/radio-button$/);
    });

    it('duplicate transitive dependencies replacement - non-matching duplicates should not modify result', () => {
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

        const resolver = () =>
            path.resolve(nonMatchingResource.context, nonMatchingResource.request);

        const finder = require('find-package-json');

        finder.mockImplementation(() => ({
            next: () => ({ value: { name: '@atlaskit/foo' } }),
        }));

        const input = { ...nonMatchingResource };
        deduplicate(input, duplicates, resolver);
        expect(nonMatchingResource).toEqual(input);
    });
});
