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
        rules: {
            // eslint-config-shaunburdick uses max-params=2 and
            // max-complexity=10. These thresholds are too aggressive
            // for a real-world multi-plugin testing tool. Raising to
            // 3 params (e.g., utility functions that take source plus
            // two derived values) and complexity 12 (plugin run()
            // methods with sample loops + error handling) maintains
            // code quality without forcing contrived refactors.
            // max-function-length raised from 50 to 65 to accommodate
            // Worker setup functions that need cohesive wiring.
            'llm-core/max-params': ['error', { max: 3 }],
            'llm-core/max-complexity': ['error', { max: 12 }],
            'llm-core/max-function-length': ['error', { max: 65 }],
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
        files: ['tests/**/*.test.js', 'tests/**/mock-*.js', 'tests/helpers/**/*.js'],
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
