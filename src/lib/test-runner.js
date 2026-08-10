/**
 * Test Runner — orchestrates speed test execution.
 *
 * @module lib/test-runner
 */

const GRACE_MS = 2000;

// === Helpers (function declarations hoist) ===

/**
 * Dispatches plugins to Web Workers.
 *
 * @param {import('./types.js').TestPlugin[]} plugins
 * @param {import('./types.js').TestConfig} config
 * @returns {Promise<import('./types.js').TestResult[]>}
 */
async function runInWorkers(plugins, config) {
    return Promise.all(plugins.map((plugin) => runInWorker(plugin, config)));
}

/**
 * Runs plugins sequentially on the main thread.
 *
 * @param {import('./types.js').TestPlugin[]} plugins
 * @param {import('./types.js').TestConfig} config
 * @returns {Promise<import('./types.js').TestResult[]>}
 */
async function runSequential(plugins, config) {
    const results = [];
    for (const plugin of plugins) {
        try {
            const timed = await runPluginWithTimeout(plugin, config);
            results.push(timed);
        } catch (error) {
            results.push(errorResult(plugin, error));
        }
    }
    return results;
}

/**
 * Runs a plugin on the main thread with timeout.
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
 * @param {import('./types.js').TestPlugin} plugin
 * @param {number} timeoutMs
 * @returns {Promise<import('./types.js').TestResult>}
 */
function timeoutResult(plugin, timeoutMs) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                targetName: plugin.name, pluginId: plugin.id,
                status: 'timeout', downloadSpeedMbps: null,
                durationMs: timeoutMs, bytesTransferred: 0,
                errorMessage: `Timed out after ${timeoutMs / 1000} seconds`,
                timestamp: new Date().toISOString(),
            });
        }, timeoutMs);
    });
}

/**
 * @param {import('./types.js').TestPlugin} plugin
 * @param {Error|object} error
 * @returns {import('./types.js').TestResult}
 */
function errorResult(plugin, error) {
    return {
        targetName: plugin.name, pluginId: plugin.id,
        status: 'error', downloadSpeedMbps: null,
        durationMs: 0, bytesTransferred: 0,
        errorMessage: error.message || 'Unknown error',
        timestamp: new Date().toISOString(),
    };
}

/**
 * @param {import('./types.js').TestPlugin} plugin
 * @param {import('./types.js').TestConfig} config
 * @returns {Promise<import('./types.js').TestResult>}
 */
function runInWorker(plugin, config) {
    return new Promise((resolve) => {
        let resolved = false;

        try {
            const worker = new Worker(
                new URL('../../src/workers/test-worker.js', import.meta.url),
                { type: 'module' }
            );
            const timeoutMs = config.timeoutMs + GRACE_MS;
            const timeoutId = setTimeout(() => onTimeout(), timeoutMs);

            worker.onmessage = (event) => {
                if (resolved) {
                    return;
                }
                const { type, result, error } = event.data;
                if (type === 'result') {
                    finish(result);
                } else if (type === 'error') {
                    finish(workerErrorResult(plugin, error));
                }
            };

            worker.onerror = () => {
                if (resolved) {
                    return;
                }
                finish({
                    targetName: plugin.name, pluginId: plugin.id,
                    status: 'error', downloadSpeedMbps: null,
                    durationMs: 0, bytesTransferred: 0,
                    errorMessage: 'Internal test error \u2014 worker failed unexpectedly',
                    timestamp: new Date().toISOString(),
                });
            };

            worker.postMessage({
                type: 'run', pluginId: plugin.id,
                pluginName: plugin.name,
                pluginCategory: plugin.category,
                pluginRunCode: plugin.run.toString(),
                config: {
                    timeoutMs: config.timeoutMs,
                    sampleDurationMs: config.sampleDurationMs,
                    adaptivePayload: config.adaptivePayload,
                },
            });

            function finish(result) {
                if (resolved) {
                    return;
                }
                resolved = true;
                clearTimeout(timeoutId);
                worker.terminate();
                resolve(result);
            }

            function onTimeout() {
                if (resolved) {
                    return;
                }
                resolved = true;
                worker.terminate();
                resolve({
                    targetName: plugin.name, pluginId: plugin.id,
                    status: 'timeout', downloadSpeedMbps: null,
                    durationMs: config.timeoutMs, bytesTransferred: 0,
                    errorMessage: `Timed out after ${config.timeoutMs / 1000} seconds`,
                    timestamp: new Date().toISOString(),
                });
            }
        } catch (error) {
            if (!resolved) {
                resolved = true;
                resolve({
                    targetName: plugin.name, pluginId: plugin.id,
                    status: 'error', downloadSpeedMbps: null,
                    durationMs: 0, bytesTransferred: 0,
                    errorMessage: `Could not create worker: ${error.message}`,
                    timestamp: new Date().toISOString(),
                });
            }
        }
    });
}

/**
 * @param {import('./types.js').TestPlugin} plugin
 * @param {string} error
 * @returns {import('./types.js').TestResult}
 */
function workerErrorResult(plugin, error) {
    return {
        targetName: plugin.name, pluginId: plugin.id,
        status: 'error', downloadSpeedMbps: null,
        durationMs: 0, bytesTransferred: 0,
        errorMessage: error || 'Worker error',
        timestamp: new Date().toISOString(),
    };
}

// === Exports ===

/**
 * Runs all registered plugins and returns their results.
 *
 * @param {import('./types.js').TestPlugin[]} plugins
 * @param {import('./types.js').TestConfig} config
 * @returns {Promise<import('./types.js').TestResult[]>}
 */
export async function runAll(plugins, config) {
    const supportsWorkers = typeof Worker !== 'undefined';
    if (supportsWorkers) {
        return runInWorkers(plugins, config);
    }
    return runSequential(plugins, config);
}
