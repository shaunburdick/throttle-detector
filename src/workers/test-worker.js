/**
 * Test Worker — generic Web Worker executor for speed test plugins.
 *
 * @module workers/test-worker
 */

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
 * Reconstructs and executes the plugin's run() function.
 * eval() is necessary because functions cannot be transferred to Workers
 * via postMessage — only their string representation survives.
 *
 * @param {{ pluginId: string, pluginName: string, pluginRunCode: string,
 *   config: object }} opts
 * @returns {Promise<import('../lib/types.js').TestResult>}
 */
async function executeRun({ pluginId, pluginName, pluginRunCode, config }) {

    const runFunction = eval(`(${pluginRunCode})`);

    if (typeof runFunction !== 'function') {
        throw new Error('Deserialized plugin code is not a function');
    }

    const startTime = Date.now();
    const result = await runFunction(config);
    const elapsed = Date.now() - startTime;

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
    const { type, pluginId, pluginName, pluginRunCode, config } = event.data;

    if (type !== 'run') {
        return;
    }
    if (!pluginRunCode || !config) {
        postError(pluginId || 'unknown',
            'Invalid run message: missing pluginRunCode or config');
        return;
    }

    try {
        const result = await executeRun({
            pluginId, pluginName, pluginRunCode, config,
        });
        self.postMessage({ type: 'result', result });
    } catch (error) {
        postError(pluginId || 'unknown',
            error.message || 'Unknown worker error');
    }
};
