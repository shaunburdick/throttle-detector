/**
 * Test Worker — generic Web Worker executor for speed test plugins.
 *
 * Dynamically imports plugin modules so that all helper functions,
 * constants, and utility imports are naturally available in the worker's
 * scope.  Each plugin module self-registers in the worker's own
 * plugin-registry, and the worker retrieves it by ID to call run().
 *
 * @module workers/test-worker
 */

import { getPlugin } from '../lib/plugin-registry.js';

/**
 * Posts an error message back to the main thread.
 *
 * @param {string} pluginId
 * @param {string} message
 */
function postError(pluginId, message) {
    self.postMessage({ type: 'error', pluginId, error: message });
}

/**
 * Coerces a possibly-malformed result into a well-formed TestResult.
 *
 * @param {{ result: object, pluginName: string, pluginId: string,
 *   elapsed: number }} opts
 * @returns {import('../lib/types.js').TestResult}
 */
function normalizeResult({ result, pluginName, pluginId, elapsed }) {
    return {
        targetName: pluginName || result.targetName || 'Unknown',
        pluginId: pluginId || result.pluginId || 'unknown',
        status: result.status || 'error',
        downloadSpeedMbps: result.downloadSpeedMbps ?? null,
        durationMs: result.durationMs || elapsed,
        bytesTransferred: result.bytesTransferred || 0,
        errorMessage: result.errorMessage || null,
        timestamp: result.timestamp || new Date().toISOString(),
    };
}

self.onmessage = async (event) => {
    const { type, pluginId, pluginName, config } = event.data;

    if (type !== 'run') {
        return;
    }
    if (!pluginId || !config) {
        postError(pluginId || 'unknown',
            'Invalid run message: missing pluginId or config');
        return;
    }

    try {
        // Dynamically import the plugin module — it self-registers
        // in the worker's own plugin-registry.
        await import(`../plugins/${pluginId}.js`);

        const plugin = getPlugin(pluginId);
        if (!plugin) {
            throw new Error(
                `Plugin "${pluginId}" not found in registry after import`
            );
        }

        const startTime = Date.now();
        const result = await plugin.run(config);

        self.postMessage({
            type: 'result',
            result: normalizeResult({
                result, pluginName, pluginId,
                elapsed: Date.now() - startTime,
            }),
        });
    } catch (error) {
        postError(pluginId || 'unknown',
            error.message || 'Unknown worker error');
    }
};
