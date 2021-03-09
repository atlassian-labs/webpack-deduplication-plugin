const mockFs = require('mock-fs');
const { createMemoisedResolver } = require('../resolver');

describe('resolver', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('resolves things', () => {
        mockFs({
            '/pkg/node_modules/@org': {
                foo: {
                    'package.json': JSON.stringify({
                        name: '@org/foo',
                        version: '1.0.0',
                        main: 'dist/index.js',
                    }),
                    dist: {
                        'index.js': '1;',
                    },
                    node_modules: {
                        other: {
                            'package.json': JSON.stringify({
                                name: 'other',
                                module: 'dist/index.js',
                                main: 'dist/none.js',
                            }),
                            dist: {
                                'index.js': '3;',
                            },
                        },
                    },
                },
                bar: {
                    'package.json': JSON.stringify({
                        name: '@org/bar',
                        version: '1.0.0',
                        module: 'dist/index.js',
                        main: 'dist/none.js',
                    }),

                    dist: { 'index.js': '0;' },
                },
            },
        });

        const resolver = createMemoisedResolver(['module', 'main']);
        const tests = [
            {
                request: '@org/bar',
                context: '/pkg',
                expected: '/pkg/node_modules/@org/bar/dist/index.js',
            },
            {
                request: '@org/foo',
                context: '/pkg/@org/bar/dist/index.js',
                expected: '/pkg/node_modules/@org/foo/dist/index.js',
            },
            {
                request: 'other',
                context: '/pkg/node_modules/@org/foo/dist/index.js',
                expected: '/pkg/node_modules/@org/foo/node_modules/other/dist/index.js',
            },
            {
                request: 'fs',
                context: '/pkg/node_modules/@org/foo/dist/index.js',
                expected: 'fs',
            },
        ];

        const results = tests.map((test) => resolver(test.request, test.context));
        mockFs.restore();
        results.forEach((result, idx) => {
            expect(result).toEqual(tests[idx].expected);
        });
    });
});
