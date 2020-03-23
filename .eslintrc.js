const importOrder = {
    "groups": [
        'builtin',
        'external',
        'internal',
        'parent',
        'sibling',
        'unknown',
    ],
    "pathGroupsExcludedImportTypes": [],
    "alphabetize": {
        "order": 'asc',
        "caseInsensitive": true
    }
};

module.exports = {
    parser: 'babel-eslint',
    env: {
        browser: true,
        es6: true,
    },
    extends: [
        'eslint:recommended',
        'plugin:prettier/recommended',
        'plugin:jest/recommended',
        'plugin:import/errors',
        'plugin:import/typescript'
    ],
    parserOptions: {
        ecmaVersion: 2018,
        sourceType: 'module',
    },
    plugins: ['prettier', 'jest'],
    rules: {
        'import/order': ['error', importOrder],
    },
    env: {
        node: true,
        'jest/globals': true,
    },
};