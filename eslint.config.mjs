import shaunburdick from 'eslint-config-shaunburdick';

export default [
    ...shaunburdick.config.js,
    {
        ignores: ['test-assets/**'],
    },
    {
        files: ['src/**/*.js'],
        languageOptions: {
            globals: {
                // Browser APIs
                performance: 'readonly',
                AbortController: 'readonly',
                AbortSignal: 'readonly',
                fetch: 'readonly',
                Image: 'readonly',
                self: 'readonly',
                Worker: 'readonly',
                localStorage: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                document: 'readonly',
                window: 'readonly',
                requestAnimationFrame: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                MessageChannel: 'readonly',
                MessagePort: 'readonly',
            },
        },
    },
    {
        files: ['src/workers/**/*.js'],
        rules: {
            'no-eval': 'off',
            'security/detect-eval-with-expression': 'off',
            '@eslint-community/eslint-comments/require-description': 'off',
        },
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
                localStorage: 'readonly',
                performance: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                AbortController: 'readonly',
                AbortSignal: 'readonly',
                fetch: 'readonly',
            },
        },
        settings: {
            'import-x/core-modules': ['vitest'],
        },
    },
];
