import shaunburdick from 'eslint-config-shaunburdick';

export default [
    ...shaunburdick.config.js,
    {
        ignores: ['test-assets/**'],
    },
    {
        files: ['tests/**/*.test.js'],
        languageOptions: {
            globals: {
                describe: 'readonly',
                it: 'readonly',
                expect: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                vi: 'readonly',
            },
        },
        settings: {
            'import-x/core-modules': ['vitest'],
        },
    },
];
