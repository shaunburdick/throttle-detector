# Contract: Plugin Interface

**Version**: 1.0.0 | **Feature**: ISP Throttle Detector

This contract defines the interface that every test plugin MUST implement. The plugin interface is the central architectural contract — all test targets, both managed (fast.com) and manufactured (CDN downloads), plug into the system through this interface.

## Plugin Object Shape

Every plugin module MUST export a single object conforming to this shape:

```js
{
  id: string,
  name: string,
  description: string,
  category: 'streaming' | 'cdn' | 'manufactured',
  workerCompatible?: boolean,  // default true; set false for DOM-only APIs
  run(config: TestConfig): Promise<TestResult>
}
```

### Field Specification

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `id` | `string` | ✅ Yes | Unique across all plugins. kebab-case. No spaces. Examples: `'fast-com'`, `'cloudflare'`, `'google-cdn'` |
| `name` | `string` | ✅ Yes | Human-readable. Max 50 chars. Displayed in UI. Example: `'Fast.com (Netflix)'` |
| `description` | `string` | ✅ Yes | One-line, max 120 chars. Shown in tooltips/info. Example: `'Download speed from Netflix Open Connect CDN'` |
| `category` | `'streaming' \| 'cdn' \| 'manufactured'` | ✅ Yes | Used for grouping in results table. `streaming`: streaming service infrastructure. `cdn`: general-purpose CDN. `manufactured`: known-file downloads from specific origins |
| `workerCompatible` | `boolean` | No | **Default: `true`**. Set to `false` if the plugin uses DOM APIs that don't exist in Web Workers (e.g., `Image` for CORS fallback). Plugins with `workerCompatible: false` run sequentially on the main thread instead of in workers. |
| `run` | `(config: TestConfig) => Promise<TestResult>` | ✅ Yes | The test execution function. Must be async. Must handle all errors internally. Must NOT throw — errors returned as TestResult with status 'error' |

### run() Method Contract

**Input**: `TestConfig` object with:
- `timeoutMs: number` — maximum execution time. Runner will abort after this.
- `sampleDurationMs: number` — duration (ms) to run the time-bounded sampling phase. Default 10000 (10s).
- `adaptivePayload: boolean` — whether to use adaptive chunk sizing.

**Output**: `Promise<TestResult>` that resolves with the measurement result.

**Error Handling**: The `run()` method MUST:
1. Catch all errors internally using try/catch
2. Never throw exceptions — all errors returned as `TestResult` with `status: 'error'`
3. Handle CORS rejection specifically (try fallback, then return error)
4. Honor the AbortSignal (check `signal.aborted` periodically, abort fetch on signal)
5. Return within `timeoutMs` — the runner will enforce this externally, but plugins should cooperate

**Self-Containment**: The `run()` function is serialized (`.toString()`) and sent to a Web Worker. Therefore:
1. No closure captures over module-level variables
2. All dependencies must be imported/included within the function body or passed via config
3. Cannot reference `this` (function is called standalone, not as method)
4. Can use built-in browser APIs (fetch, performance, AbortController, Image, etc.)
5. Plugins using DOM-only APIs (like `Image`) should set `workerCompatible: false` to run on the main thread instead

**Thread Safety**: Plugins run in isolation (one per Worker). They must not:
1. Mutate shared state (localStorage, DOM)
2. Communicate with other plugins
3. Assume any execution order relative to other plugins

### TestResult Shape (Return Value)

```js
{
  targetName: "Fast.com (Netflix)",   // string — display name
  pluginId: "fast-com",              // string — matches plugin.id
  status: "success",                 // "success" | "error" | "timeout"
  downloadSpeedMbps: 87.5,           // number | null — Mbps, null on error/timeout
  durationMs: 8423,                  // number — test duration in ms
  bytesTransferred: 52428800,        // number — total bytes downloaded
  errorMessage: null,                // string | null — null on success
  timestamp: "2026-08-10T14:30:00.000Z"  // ISO 8601 string
}
```

## Plugin Implementation Template

```js
// Example: plugins/my-target.js

/**
 * @type {import('../lib/types.js').TestPlugin}
 */
const myTargetPlugin = {
  id: 'my-target',
  name: 'My Target (Description)',
  description: 'Download speed from My Target infrastructure',
  category: 'cdn',

  async run(config) {
    const startTime = performance.now();
    let totalBytes = 0;

    try {
      // Phase 1: Probe with small payload
      const probeResult = await this._downloadAndMeasure(
        'https://my-target.example.com/test?size=128KB',
        128 * 1024
      );
      totalBytes += probeResult.bytes;

      // Phase 2: Scale based on probe result
      const payloadSize = this._determinePayloadSize(probeResult.speedMbps, config);
      const finalResult = await this._downloadAndMeasure(
        `https://my-target.example.com/test?size=${payloadSize}`,
        payloadSize
      );
      totalBytes += finalResult.bytes;

      const durationMs = performance.now() - startTime;

      return {
        targetName: this.name,
        pluginId: this.id,
        status: 'success',
        downloadSpeedMbps: finalResult.speedMbps,
        durationMs: Math.round(durationMs),
        bytesTransferred: totalBytes,
        errorMessage: null,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const durationMs = performance.now() - startTime;
      return {
        targetName: this.name,
        pluginId: this.id,
        status: 'error',
        downloadSpeedMbps: null,
        durationMs: Math.round(durationMs),
        bytesTransferred: totalBytes,
        errorMessage: error.message || 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  },

  // Private helper (not serialized to Worker — must be defined inside run()
  // or inlined)
  _downloadAndMeasure(url, expectedBytes) { /* ... */ },
  _determinePayloadSize(probeSpeed, config) { /* ... */ }
};

export default myTargetPlugin;
```

**Note**: In practice, helper methods like `_downloadAndMeasure` cannot be on the plugin object (they won't survive serialization to Worker). These must be either:
1. Defined as local functions inside `run()`, or
2. Defined in a shared utility and copy-pasted into the plugin function body during build

The recommended pattern for plugins is to define all logic within the `run()` function or as local helper functions inside it.

## Registration Contract

Plugins register themselves via the plugin registry:

```js
// plugins/plugin-registry.js
import { registerPlugin } from '../lib/plugin-registry.js';
import { myTargetPlugin } from './my-target.js';

registerPlugin(myTargetPlugin);
```

The registry exposes:
- `registerPlugin(plugin: TestPlugin): void` — registers a plugin
- `getPlugins(): TestPlugin[]` — returns all registered plugins
- `getPlugin(id: string): TestPlugin | undefined` — looks up by ID

Duplicate `id` registration throws an error at registration time (fail-fast).

## Backward Compatibility

**Version 1.0.0**: Initial interface. Future versions must maintain backward compatibility:
- New optional fields may be added to TestConfig or TestResult
- Required fields cannot be removed
- Type changes require a major version bump

## Compliance Verification

To verify a plugin conforms to this contract:
1. It exports an object with all five required fields
2. `run()` returns a Promise that resolves to a TestResult
3. Errors result in `status: 'error'`, not thrown exceptions
4. All TestResult fields are present with correct types
5. Plugin does not mutate external state

The test suite includes a `contract/plugin-interface.test.js` that validates any conforming plugin against these rules.
