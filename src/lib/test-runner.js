/**
 * Test Runner — orchestrates speed test execution.
 *
 * @module lib/test-runner
 */

const GRACE_MS = 2000;

// === Helpers (function declarations hoist) ===
// Ordered so every function is defined before its first use.

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
 * @returns {import('./types.js').TestResult}
 */
function buildTimeoutResult(plugin, timeoutMs) {
    return {
        targetName: plugin.name, pluginId: plugin.id,
        status: 'timeout', downloadSpeedMbps: null,
        durationMs: timeoutMs, bytesTransferred: 0,
        errorMessage: `Timed out after ${timeoutMs / 1000} seconds`,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Creates a Worker instance and wires up lifecycle handlers.
 *
 * @param {import('./types.js').TestPlugin} plugin
 * @param {import('./types.js').TestConfig} config
 * @param {(result: import('./types.js').TestResult) => void} resolve
 * @returns {{ worker: Worker, timeoutId: number }}
 */
function setupWorker(plugin, config, resolve) {
    const worker = new Worker(
        new URL('../../src/workers/test-worker.js', import.meta.url),
        { type: 'module' }
    );
    const timeoutMs = config.timeoutMs + GRACE_MS;
    let resolved = false;
    let timer = null;

    const finish = (result) => {
        if (resolved) {
            return;
        }
        resolved = true;
        clearTimeout(timer);
        worker.terminate();
        resolve(result);
    };

    const onTimeout = () => {
        if (resolved) {
            return;
        }
        resolved = true;
        worker.terminate();
        resolve(buildTimeoutResult(plugin, config.timeoutMs));
    };

    timer = setTimeout(onTimeout, timeoutMs);

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
        type: 'run',
        pluginId: plugin.id,
        pluginName: plugin.name,
        config: {
            timeoutMs: config.timeoutMs,
            sampleDurationMs: config.sampleDurationMs,
            adaptivePayload: config.adaptivePayload,
        },
    });

    return { worker, timeoutId: timer };
}

/**
 * @param {import('./types.js').TestPlugin} plugin
 * @param {import('./types.js').TestConfig} config
 * @returns {Promise<import('./types.js').TestResult>}
 */
function runInWorker(plugin, config) {
    return new Promise((resolve) => {
        try {
            setupWorker(plugin, config, resolve);
        } catch (error) {
            resolve({
                targetName: plugin.name, pluginId: plugin.id,
                status: 'error', downloadSpeedMbps: null,
                durationMs: 0, bytesTransferred: 0,
                errorMessage: `Could not create worker: ${error.message}`,
                timestamp: new Date().toISOString(),
            });
        }
    });
}

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
