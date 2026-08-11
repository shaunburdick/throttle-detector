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
 * Runs all plugins sequentially — one at a time on the main thread.
 *
 * Sequential execution eliminates the network contention that caused
 * false-positive throttling signals when plugins competed for bandwidth
 * in parallel Web Workers.
 *
 * @param {import('./types.js').TestPlugin[]} plugins
 * @param {import('./types.js').TestConfig} config
 * @param {function(number, number): void} [onProgress] — Optional callback
 *        invoked after each plugin completes. Receives `(done, total)` where
 *        `done` is the number of completed plugins and `total` is the total
 *        plugin count. Use this to drive incremental progress indicators
 *        during long test runs.
 * @returns {Promise<import('./types.js').TestResult[]>}
 */
export async function runAll(plugins, config, onProgress) {
    const results = [];
    for (const plugin of plugins) {
        try {
            const timed = await runPluginWithTimeout(plugin, config);
            results.push(timed);
        } catch (error) {
            results.push(errorResult(plugin, error));
        }
        if (onProgress) {
            onProgress(results.length, plugins.length);
        }
    }
    return results;
}
