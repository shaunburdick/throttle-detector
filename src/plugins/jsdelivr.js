/**
 * jsDelivr CDN manufactured speed test plugin.
 *
 * @module plugins/jsdelivr
 */

import { registerPlugin } from '../lib/plugin-registry.js';

const SAMPLE_DURATION_MS = 10000;
const WARMUP_DURATION_MS = 1000;
const BYTES_PER_SECOND = 1000;
const BITS_PER_BYTE = 8;
const BYTES_PER_MILLION = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;
const OUTLIER_TRIM_RATIO = 0.1;
const MIN_SAMPLES = 3;

const JSDELIVR_URLS = [
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js',
    'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// === Helper functions (declared first so they hoist for no-use-before-define) ===

/** @returns {{bytes: number, speedMbps: number, durationMs: number}} */
function zeroResult() {
    return { bytes: 0, speedMbps: 0, durationMs: 0 };
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>}
 */
async function downloadMeasure(url, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        Math.min(timeoutMs, FETCH_TIMEOUT_MS)
    );

    try {
        const fetchStart = performance.now();
        const response = await fetch(url, {
            signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) {
            return zeroResult();
        }

        await response.blob();
        const durationMs = performance.now() - fetchStart;
        let bytes = 0;
        const entries = performance.getEntriesByName(url);
        if (entries.length > 0) {
            const entry = entries[entries.length - 1];
            bytes = entry.transferSize || entry.encodedBodySize || 0;
        }
        if (bytes === 0) {
            return zeroResult();
        }

        const bytesPerSec = bytes / (durationMs / BYTES_PER_SECOND);
        const speedMbps = (bytesPerSec * BITS_PER_BYTE) / BYTES_PER_MILLION;
        return { bytes, speedMbps, durationMs };
    } catch {
        return zeroResult();
    } finally {
        clearTimeout(timeoutId);
    }
}

/** @param {number[]} samples @returns {number|null} */
function computeFinalSpeed(samples) {
    if (samples.length === 0) {
        return null;
    }
    if (samples.length < MIN_SAMPLES) {
        return samples.reduce((total, value) => total + value, 0)
            / samples.length;
    }
    const sorted = [...samples].sort((first, second) => first - second);
    const trimCount = Math.max(1,
        Math.floor(samples.length * OUTLIER_TRIM_RATIO));
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    if (trimmed.length === 0) {
        return sorted.reduce((total, value) => total + value, 0)
            / sorted.length;
    }
    return trimmed.reduce((total, value) => total + value, 0)
        / trimmed.length;
}

/**
 * @param {'success'|'error'} status
 * @param {number|null} speedMbps
 * @param {number} durationMs
 * @param {number} bytesTransferred
 * @param {string|null} errorMessage
 * @returns {import('../lib/types.js').TestResult}
 */
function buildResult({ status, speedMbps, durationMs, bytesTransferred,
    errorMessage }) {
    return {
        targetName: 'jsDelivr CDN', pluginId: 'jsdelivr',
        status, downloadSpeedMbps: speedMbps,
        durationMs, bytesTransferred, errorMessage,
        timestamp: new Date().toISOString(),
    };
}

// === Plugin definition ===

const jsdelivrPlugin = {
    id: 'jsdelivr',
    name: 'jsDelivr CDN',
    description: 'Download speed from jsDelivr global CDN network',
    category: 'cdn',

    async run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs || SAMPLE_DURATION_MS;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
        let totalBytes = 0;
        const samples = [];

        try {
            let idx = 0;
            while (performance.now() - startTime < sampleDuration) {
                if (performance.now() - startTime > timeoutMs) {
                    break;
                }
                const baseUrl = JSDELIVR_URLS[idx % JSDELIVR_URLS.length];
                const url = `${baseUrl}?_cb=${Date.now()}`;
                const sample = await downloadMeasure(url, timeoutMs);
                totalBytes += sample.bytes;
                if (sample.speedMbps > 0
                    && performance.now() - startTime > WARMUP_DURATION_MS) {
                    samples.push(sample.speedMbps);
                }
                idx++;
            }
            return buildResult({
                status: 'success',
                speedMbps: computeFinalSpeed(samples),
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage: samples.length < MIN_SAMPLES
                    ? 'Not enough valid samples collected' : null,
            });
        } catch (error) {
            return buildResult({
                status: 'error', speedMbps: null,
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage: error.message || 'Unknown error',
            });
        }
    },
};

registerPlugin(jsdelivrPlugin);
export { jsdelivrPlugin };
