/**
 * jsDelivr CDN speed test plugin.
 *
 * Downloads large npm package files from cdn.jsdelivr.net — the
 * world's largest open-source CDN with CORS + Timing-Allow-Origin
 * headers enabled on all assets.
 *
 * Uses 3 MB to 32 MB files for meaningful throughput measurement
 * on high-speed connections.
 *
 * @module plugins/jsdelivr
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import { bytesToMbps, trimmedMean } from '../lib/utils.js';

const SAMPLE_DURATION_MS = 10000;
const WARMUP_DURATION_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;

/**
 * Large npm package assets served by jsDelivr.
 * All have CORS + Timing-Allow-Origin headers.
 *
 * - @ffmpeg/core WASM binary: ~32 MB
 * - @tensorflow/tfjs minified bundle: ~1.5 MB
 * - three.js build: ~670 KB (fallback when larger files succeed)
 */
const JSDELIVR_URLS = [
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
];

// === Helper functions ===

/** @returns {{bytes: number, speedMbps: number, durationMs: number}} */
function zeroResult() {
    return { bytes: 0, speedMbps: 0, durationMs: 0 };
}

/**
 * Downloads a file from jsDelivr and measures throughput.
 *
 * Uses Resource Timing API with prefix matching for reliable byte counts
 * regardless of cache-busting query parameter variations.
 *
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
            signal: controller.signal,
            cache: 'no-store',
        });
        if (!response.ok) {
            return zeroResult();
        }

        // Capture Content-Length before reading body
        const cl = response.headers.get('content-length');
        const contentLength = cl ? parseInt(cl, 10) : 0;

        await response.blob();
        const durationMs = performance.now() - fetchStart;

        // Try Resource Timing first, fall back to Content-Length header
        const urlPrefix = url.split('?')[0];
        let bytes = 0;
        const entries = performance.getEntriesByType('resource');
        for (const entry of entries) {
            if (entry.name.startsWith(urlPrefix)) {
                bytes = entry.transferSize
                    || entry.encodedBodySize
                    || contentLength;
                break;
            }
        }
        if (bytes === 0) {
            bytes = contentLength;
        }
        if (bytes === 0) {
            return zeroResult();
        }

        const speedMbps = bytesToMbps(bytes, durationMs);
        return { bytes, speedMbps, durationMs };
    } catch {
        return zeroResult();
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * @param {{ status: 'success'|'error', speedMbps: number|null,
 *   durationMs: number, bytesTransferred: number, errorMessage: string|null
 * }} opts
 * @returns {import('../lib/types.js').TestResult}
 */
function buildResult({ status, speedMbps, durationMs, bytesTransferred,
    errorMessage }) {
    return {
        targetName: 'jsDelivr CDN',
        pluginId: 'jsdelivr',
        status,
        downloadSpeedMbps: speedMbps,
        durationMs,
        bytesTransferred,
        errorMessage,
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
            const speed = trimmedMean(samples);
            return buildResult({
                status: speed !== null ? 'success' : 'error',
                speedMbps: speed,
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage: speed === null
                    ? 'Not enough valid samples collected' : null,
            });
        } catch (error) {
            return buildResult({
                status: 'error',
                speedMbps: null,
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage: error.message || 'Unknown error',
            });
        }
    },
};

registerPlugin(jsdelivrPlugin);
export { jsdelivrPlugin };
