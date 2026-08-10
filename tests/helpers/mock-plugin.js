/**
 * Mock test plugin factory for unit/integration testing.
 *
 * @module tests/helpers/mock-plugin
 */

const BITS_PER_BYTE = 8;
const MS_PER_SEC = 1000;
const BYTES_PER_MILLION = 1_000_000;

/**
 * Creates a valid mock plugin that resolves with the given speed.
 *
 * @param {object} options
 * @param {string} options.id - Plugin ID
 * @param {string} options.name - Display name
 * @param {number} options.speedMbps - Download speed in Mbps
 * @param {number} options.delayMs - Simulated delay in ms
 * @param {number} options.bytesToTransfer - Bytes to report
 * @returns {import('../../src/lib/types.js').TestPlugin}
 */
export function createSuccessPlugin({
    id = 'mock-success',
    name = 'Mock Success',
    speedMbps = 50,
    delayMs = 100,
    bytesToTransfer,
} = {}) {
    const bytes = bytesToTransfer !== undefined
        ? bytesToTransfer
        : Math.round((speedMbps * BYTES_PER_MILLION / BITS_PER_BYTE)
            * (delayMs / MS_PER_SEC));

    return {
        id,
        name,
        description: `Mock plugin returning ${speedMbps} Mbps`,
        category: 'cdn',
        async run() {
            await new Promise((resolve) => {
                setTimeout(resolve, delayMs);
            });
            return {
                targetName: name,
                pluginId: id,
                status: 'success',
                downloadSpeedMbps: speedMbps,
                durationMs: delayMs,
                bytesTransferred: bytes,
                errorMessage: null,
                timestamp: new Date().toISOString(),
            };
        },
    };
}

/**
 * Creates a mock plugin that fails.
 *
 * @param {object} options
 * @returns {import('../../src/lib/types.js').TestPlugin}
 */
export function createErrorPlugin({
    id = 'mock-error',
    name = 'Mock Error',
    errorMessage = 'Mock error',
    delayMs = 50,
} = {}) {
    return {
        id,
        name,
        description: 'Mock plugin that always fails',
        category: 'cdn',
        async run() {
            await new Promise((resolve) => {
                setTimeout(resolve, delayMs);
            });
            return {
                targetName: name,
                pluginId: id,
                status: 'error',
                downloadSpeedMbps: null,
                durationMs: delayMs,
                bytesTransferred: 0,
                errorMessage,
                timestamp: new Date().toISOString(),
            };
        },
    };
}

/**
 * Creates a mock plugin that times out.
 *
 * @param {object} options
 * @returns {import('../../src/lib/types.js').TestPlugin}
 */
export function createTimeoutPlugin({
    id = 'mock-timeout',
    name = 'Mock Timeout',
    delayMs = 35000,
} = {}) {
    return {
        id,
        name,
        description: 'Mock plugin that always times out',
        category: 'cdn',
        async run() {
            await new Promise((resolve) => {
                setTimeout(resolve, delayMs);
            });
            return {
                targetName: name,
                pluginId: id,
                status: 'timeout',
                downloadSpeedMbps: null,
                durationMs: delayMs,
                bytesTransferred: 0,
                errorMessage: 'Timed out',
                timestamp: new Date().toISOString(),
            };
        },
    };
}

/**
 * Creates a mock plugin that throws an exception.
 *
 * @param {object} options
 * @returns {import('../../src/lib/types.js').TestPlugin}
 */
export function createThrowingPlugin({
    id = 'mock-throw',
    name = 'Mock Throw',
} = {}) {
    return {
        id,
        name,
        description: 'Mock plugin that crashes',
        category: 'cdn',
        async run() {
            throw new Error('Plugin crash!');
        },
    };
}
