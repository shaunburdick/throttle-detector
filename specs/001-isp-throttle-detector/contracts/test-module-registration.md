# Contract: Test Module Registration API

**Version**: 1.0.0 | **Feature**: ISP Throttle Detector

This contract defines how test plugin modules are registered with the test runner and how the runner discovers available plugins at runtime.

## Registry API

### Core Functions

```js
// lib/plugin-registry.js

/**
 * Register a test plugin. Must be called before the test runner starts.
 * Throws if a plugin with the same id is already registered.
 *
 * @param {TestPlugin} plugin - Plugin object conforming to plugin-interface contract
 * @throws {Error} If plugin.id is already registered
 * @throws {Error} If plugin is missing required fields
 */
export function registerPlugin(plugin) { ... }

/**
 * Returns all registered plugins in registration order.
 * @returns {TestPlugin[]}
 */
export function getPlugins() { ... }

/**
 * Looks up a plugin by its unique ID.
 * @param {string} id - Plugin ID
 * @returns {TestPlugin | undefined}
 */
export function getPlugin(id) { ... }

/**
 * Returns the number of registered plugins.
 * @returns {number}
 */
export function getPluginCount() { ... }

/**
 * Removes all registered plugins. Primarily for testing.
 */
export function clearPlugins() { ... }
```

### Registration Flow

```
1. index.html loads app.js
2. app.js imports plugins/plugin-registry.js
   ├─ This triggers side-effect imports of all plugin modules
   └─ Each plugin module calls registerPlugin(self)
3. After all imports resolve, getPlugins() is available
4. TestRunner calls getPlugins() when starting a test run
```

### Module Registration Pattern

Each plugin module registers itself on import:

```js
// plugins/fast-com.js
import { registerPlugin } from '../lib/plugin-registry.js';

const fastComPlugin = {
  id: 'fast-com',
  name: 'Fast.com (Netflix)',
  description: 'Download speed from Netflix Open Connect CDN',
  category: 'streaming',
  async run(config) { /* ... */ }
};

registerPlugin(fastComPlugin);
export { fastComPlugin };
```

### Adding a New Plugin

To add a new test target, a developer:

1. Creates `src/plugins/<id>.js`
2. Implements the TestPlugin interface
3. Calls `registerPlugin(plugin)` at module scope
4. Imports the module in `app.js` (or it's auto-discovered)

**Constraint from FR-007**: Adding a new test target MUST NOT require changes to the core test runner or result display logic. The plugin registry + plugin interface contract ensures this.

## Plugin Discovery

### Current: Explicit Import (MVP)

```js
// app.js
import './plugins/fast-com.js';     // Side-effect: registers itself
import './plugins/cloudflare.js';   // Side-effect: registers itself
import './plugins/google-cdn.js';   // Side-effect: registers itself
import './plugins/jsdelivr.js';     // Side-effect: registers itself
```

This is simple, explicit, and works without a build step. The import side-effect triggers `registerPlugin()`.

### Future: Directory Scanning (Post-MVP)

A potential future enhancement: auto-discover plugins in the `plugins/` directory:

```js
// Future: dynamic import of all plugin modules
const pluginModules = await Promise.all(
  pluginFileList.map(file => import(`./plugins/${file}`))
);
// Each module self-registers on import
```

This would allow adding a plugin without touching any registration code. Not in MVP scope — explicit imports are sufficient for 4 plugins.

## Validation at Registration Time

```js
export function registerPlugin(plugin) {
  // 1. Validate required fields
  const required = ['id', 'name', 'description', 'category', 'run'];
  for (const field of required) {
    if (!(field in plugin)) {
      throw new Error(`Plugin missing required field: ${field}`);
    }
  }

  // 2. Validate types
  if (typeof plugin.id !== 'string' || !plugin.id) {
    throw new Error('Plugin id must be a non-empty string');
  }
  if (typeof plugin.run !== 'function') {
    throw new Error('Plugin run must be a function');
  }
  if (!['streaming', 'cdn', 'manufactured'].includes(plugin.category)) {
    throw new Error(`Invalid plugin category: ${plugin.category}`);
  }

  // 3. Check for duplicates
  if (registry.has(plugin.id)) {
    throw new Error(`Plugin already registered: ${plugin.id}`);
  }

  // 4. Register
  registry.set(plugin.id, plugin);
}
```

Fail-fast validation at registration time catches configuration errors early (when the page loads) rather than later (when a test runs).

## Plugin Execution Order

Plugins execute in parallel (one Web Worker each). The registry does not impose any ordering — all plugins start simultaneously. Results are collected as they arrive (first-come, first-served display order).

For the sequential fallback (no Web Workers), plugins execute in registration order.

## Registry State

- The registry is a module-level `Map<string, TestPlugin>`
- State persists for the lifetime of the page
- `clearPlugins()` resets state — primarily for test isolation
- No persistence across page loads (plugins are code, not data)

## Contract Compliance

The test suite validates:

1. **Registration**: Plugins with valid shapes are accepted; invalid shapes throw
2. **Deduplication**: Duplicate IDs throw at registration
3. **Discovery**: `getPlugins()` returns all registered plugins after import
4. **Isolation**: `clearPlugins()` resets state between tests
5. **FR-007 compliance**: Adding a new plugin module + import = no changes to test runner or UI code
