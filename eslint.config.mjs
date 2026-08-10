import shaunburdick from 'eslint-config-shaunburdick';

export default [
    ...shaunburdick.config.js,
    {
        ignores: ['test-assets/**'],
    },
];
