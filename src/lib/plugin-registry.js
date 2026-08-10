/**
 * Plugin Registry — central registration for test plugins.
 *
 * Plugins self-register on import via registerPlugin(). The registry
 * provides discovery methods for the test runner.
 *
 * @module lib/plugin-registry
 */

/** @type {Map<string, import('./types.js').TestPlugin>} */
const registry = new Map();

/**
 * Registers a test plugin. Must be called before the test runner starts.
 * Throws if a plugin with the same id is already registered.
 *
 * @param {import('./types.js').TestPlugin} plugin - Plugin object
 * @throws {Error} If plugin.id is already registered or plugin is invalid
 */
export function registerPlugin(plugin) {
    // Validate required fields
    const required = ['id', 'name', 'description', 'category', 'run'];
    for (const field of required) {
        if (!(field in plugin)) {
            throw new Error(`Plugin missing required field: ${field}`);
        }
    }

    // Validate types
    if (typeof plugin.id !== 'string' || !plugin.id) {
        throw new Error('Plugin id must be a non-empty string');
    }
    if (typeof plugin.run !== 'function') {
        throw new Error('Plugin run must be a function');
    }
    const validCategories = ['streaming', 'cdn', 'manufactured'];
    if (!validCategories.includes(plugin.category)) {
        throw new Error(
            `Invalid plugin category: ${plugin.category}. ` +
            `Expected: ${validCategories.join(', ')}`
        );
    }

    // Check for duplicates
    if (registry.has(plugin.id)) {
        throw new Error(`Plugin already registered: ${plugin.id}`);
    }

    registry.set(plugin.id, plugin);
}

/**
 * Returns all registered plugins in registration order.
 *
 * @returns {import('./types.js').TestPlugin[]}
 */
export function getPlugins() {
    return [...registry.values()];
}

/**
 * Looks up a plugin by its unique ID.
 *
 * @param {string} id - Plugin ID
 * @returns {import('./types.js').TestPlugin | undefined}
 */
export function getPlugin(id) {
    return registry.get(id);
}

/**
 * Returns the number of registered plugins.
 *
 * @returns {number}
 */
export function getPluginCount() {
    return registry.size;
}

/**
 * Removes all registered plugins. Primarily for testing.
 */
export function clearPlugins() {
    registry.clear();
}
