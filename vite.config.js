import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.js'],
        coverage: {
            include: ['src/lib/**/*.js', 'src/plugins/plugin-registry.js'],
            reporter: ['text', 'lcov'],
        },
    },
});
