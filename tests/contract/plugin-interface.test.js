import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerPlugin,
    getPlugins,
    getPlugin,
    getPluginCount,
    clearPlugins,
} from '../../src/lib/plugin-registry.js';

/**
 * Creates a valid mock plugin for testing.
 *
 * @param {string} pluginId - Plugin ID
 * @param {object} overrides - Optional overrides
 * @returns {import('../../src/lib/types.js').TestPlugin}
 */
function createMockPlugin(pluginId, overrides = {}) {
    return {
        id: pluginId,
        name: `Mock ${pluginId}`,
        description: 'A mock plugin for testing',
        category: 'cdn',
        async run() {
            return {
                targetName: `Mock ${pluginId}`,
                pluginId,
                status: 'success',
                downloadSpeedMbps: 100,
                durationMs: 1000,
                bytesTransferred: 1024,
                errorMessage: null,
                timestamp: new Date().toISOString(),
                category: 'cdn',
            };
        },
        ...overrides,
    };
}

describe('Plugin Registry', () => {
    beforeEach(() => {
        clearPlugins();
    });

    describe('registerPlugin', () => {
        it('registers a valid plugin', () => {
            const plugin = createMockPlugin('test');
            expect(() => registerPlugin(plugin)).not.toThrow();
            expect(getPluginCount()).toBe(1);
        });

        it('throws when required fields are missing', () => {
            expect(() => registerPlugin({})).toThrow('missing required field');
            expect(() => registerPlugin({ id: 'x' })).toThrow('missing required field');
        });

        it('throws for invalid id type', () => {
            expect(() => registerPlugin({ ...createMockPlugin('x'), id: 123 }))
                .toThrow('must be a non-empty string');
            expect(() => registerPlugin({ ...createMockPlugin('x'), id: '' }))
                .toThrow('must be a non-empty string');
        });

        it('throws when run is not a function', () => {
            const plugin = { ...createMockPlugin('x'), run: 'not a function' };
            expect(() => registerPlugin(plugin)).toThrow('must be a function');
        });

        it('throws for invalid category', () => {
            const plugin = { ...createMockPlugin('x'), category: 'invalid' };
            expect(() => registerPlugin(plugin)).toThrow('Invalid plugin category');
        });

        it('accepts all valid categories', () => {
            for (const cat of ['streaming', 'cdn', 'manufactured']) {
                clearPlugins();
                const plugin = createMockPlugin(cat, { category: cat });
                expect(() => registerPlugin(plugin)).not.toThrow();
            }
        });

        it('throws on duplicate registration', () => {
            const plugin = createMockPlugin('dup');
            registerPlugin(plugin);
            expect(() => registerPlugin(plugin)).toThrow('already registered');
        });
    });

    describe('getPlugins', () => {
        it('returns empty array when no plugins registered', () => {
            expect(getPlugins()).toEqual([]);
        });

        it('returns all registered plugins in order', () => {
            const first = createMockPlugin('first');
            const second = createMockPlugin('second');
            registerPlugin(first);
            registerPlugin(second);
            const plugins = getPlugins();
            expect(plugins).toHaveLength(2);
            expect(plugins[0].id).toBe('first');
            expect(plugins[1].id).toBe('second');
        });
    });

    describe('getPlugin', () => {
        it('returns undefined for unknown id', () => {
            expect(getPlugin('nonexistent')).toBeUndefined();
        });

        it('returns the plugin for a known id', () => {
            const plugin = createMockPlugin('known');
            registerPlugin(plugin);
            expect(getPlugin('known')).toBe(plugin);
        });
    });

    describe('getPluginCount', () => {
        it('returns 0 initially', () => {
            expect(getPluginCount()).toBe(0);
        });

        it('returns correct count after registration', () => {
            registerPlugin(createMockPlugin('alpha'));
            registerPlugin(createMockPlugin('beta'));
            expect(getPluginCount()).toBe(2);
        });
    });

    describe('clearPlugins', () => {
        it('removes all plugins', () => {
            registerPlugin(createMockPlugin('alpha'));
            registerPlugin(createMockPlugin('beta'));
            clearPlugins();
            expect(getPluginCount()).toBe(0);
            expect(getPlugins()).toEqual([]);
        });

        it('is idempotent', () => {
            clearPlugins();
            clearPlugins();
            expect(getPluginCount()).toBe(0);
        });
    });

    describe('FR-007 compliance', () => {
        it('new plugin registration does not require any special setup', () => {
            const newPlugin = createMockPlugin('new-service', {
                name: 'New Service',
                description: 'A brand new test target',
                category: 'manufactured',
            });
            registerPlugin(newPlugin);
            expect(getPlugin('new-service')).toBe(newPlugin);
            expect(getPluginCount()).toBe(1);
        });
    });
});
