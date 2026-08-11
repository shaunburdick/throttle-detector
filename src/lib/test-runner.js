/**
 * Test Runner — orchestrates sequential speed test execution.
 *
 * All tests run one at a time on the main thread so that each
 * plugin gets dedicated bandwidth. Parallel worker execution
 * was removed because it caused false-positive throttling signals
 * when the fastest plugin (Cloudflare) consumed most of the pipe.
 *
 * @module lib/test-runner
 */

/**
 * Creates a timeout result after the configured timeout elapses.
 *
 * @param {import('./types.js').TestPlugin} plugin
 * @param {number} timeoutMs
 * @returns {Promise<import('./types.js').TestResult>}
 */
function timeoutResult(plugin, timeoutMs) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                targetName: plugin.name,
                pluginId: plugin.id,
                status: 'timeout',
                downloadSpeedMbps: null,
                durationMs: timeoutMs,
                bytesTransferred: 0,
                errorMessage: `Timed out after ${timeoutMs / 1000} seconds`,
                timestamp: new Date().toISOString(),
                category: plugin.category,
            });
        }, timeoutMs);
    });
}

/**
 * Builds an error result from a caught exception.
 *
 * @param {import('./types.js').TestPlugin} plugin
 * @param {Error|object} error
 * @returns {import('./types.js').TestResult}
 */
function errorResult(plugin, error) {
    return {
        targetName: plugin.name,
        pluginId: plugin.id,
        status: 'error',
        downloadSpeedMbps: null,
        durationMs: 0,
        bytesTransferred: 0,
        errorMessage: error.message || 'Unknown error',
        timestamp: new Date().toISOString(),
        category: plugin.category,
    };
}

/**
 * Runs a single plugin with a timeout guard via Promise.race.
 *
 * @param {import('./types.js').TestPlugin} plugin
 * @param {import('./types.js').TestConfig} config
 * @returns {Promise<import('./types.js').TestResult>}
 */
async function runPluginWithTimeout(plugin, config) {
    return Promise.race([
        plugin.run(config),
        timeoutResult(plugin, config.timeoutMs),
    ]);
}

/**
 * Options for the runAll orchestrator.
 *
 * @typedef {Object} RunAllOptions
 * @property {import('./types.js').TestPlugin[]} plugins
 * @property {import('./types.js').TestConfig} config
 * @property {function({ done: number, total: number, pluginId: string, success: boolean }): void} [onProgress]
 * @property {function(pluginId: string): void} [onPluginStart]
 */

/**
 * Runs all plugins sequentially — one at a time on the main thread.
 *
 * Sequential execution eliminates the network contention that caused
 * false-positive throttling signals when plugins competed for bandwidth
 * in parallel Web Workers.
 *
 * @param {RunAllOptions} options
 * @returns {Promise<import('./types.js').TestResult[]>}
 */
export async function runAll({ plugins, config, onProgress, onPluginStart }) {
    const results = [];
    for (const plugin of plugins) {
        if (onPluginStart) {
            onPluginStart(plugin.id);
        }
        try {
            const timed = await runPluginWithTimeout(plugin, config);
            results.push(timed);
        } catch (error) {
            results.push(errorResult(plugin, error));
        }
        if (onProgress) {
            const lastResult = results[results.length - 1];
            onProgress({
                done: results.length,
                total: plugins.length,
                pluginId: lastResult.pluginId,
                success: lastResult.status === 'success',
            });
        }
    }
    return results;
}
