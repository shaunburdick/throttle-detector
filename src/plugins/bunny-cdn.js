/**
 * Bunny CDN speed test plugin.
 *
 * Downloads font assets from fonts.bunny.net (Bunny CDN's first-party
 * font delivery service) using byte-range requests, measuring throughput
 * over a time-bounded sampling window.
 *
 * Each font file is small (~22 KB), so the plugin uses Range requests
 * to control download sizes and ensure meaningful timing measurements.
 *
 * @module plugins/bunny-cdn
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import { bytesToMbps, trimmedMean } from '../lib/utils.js';

/**
 * Public font file URLs served from Bunny CDN's fonts.bunny.net edge.
 * Each is a woff2 font file (~15-25 KB) that supports Range requests.
 */
const BUNNY_FONT_URLS = [
    'https://fonts.bunny.net/roboto/files/roboto-latin-400-normal.woff2',
    'https://fonts.bunny.net/roboto/files/roboto-latin-700-normal.woff2',
    'https://fonts.bunny.net/open-sans/files/open-sans-latin-400-normal.woff2',
    'https://fonts.bunny.net/open-sans/files/open-sans-latin-700-normal.woff2',
    'https://fonts.bunny.net/lato/files/lato-latin-400-normal.woff2',
    'https://fonts.bunny.net/lato/files/lato-latin-700-normal.woff2',
];

const SAMPLE_DURATION_MS = 10000;
const WARMUP_DURATION_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;
const KIB = 1024;

/** Speed thresholds (Mbps) for adaptive chunk sizing. */
const SLOW_SPEED = 5;
const MEDIUM_SPEED = 50;
const FAST_SPEED = 200;

/** HTTP 206 Partial Content — expected when using Range requests. */
const HTTP_PARTIAL_CONTENT = 206;

/** Adaptive chunk sizes. Font files are small so cap at 16 KiB. */
const MIN_CHUNK = 4 * KIB;
const MED_CHUNK = 8 * KIB;
const LARGE_CHUNK = 16 * KIB;
const MAX_CHUNK = 16 * KIB;

// === Helpers (function declarations hoist) ===

/** @returns {{bytes: number, speedMbps: number, durationMs: number}} */
function zeroSample() {
    return { bytes: 0, speedMbps: 0, durationMs: 0 };
}

/**
 * Returns actual transfer bytes from the Resource Timing API.
 *
 * @param {string} urlPrefix
 * @param {number} fallback
 * @returns {number}
 */
function getTransferBytes(urlPrefix, fallback) {
    const entries = performance.getEntriesByType('resource');
    const prefix = urlPrefix.split('?')[0];
    for (const entry of entries) {
        if (entry.name.startsWith(prefix)) {
            if (entry.transferSize > 0) {
                return entry.transferSize;
            }
            if (entry.encodedBodySize > 0) {
                return entry.encodedBodySize;
            }
            if (entry.decodedBodySize > 0) {
                return entry.decodedBodySize;
            }
            return fallback;
        }
    }
    return fallback;
}

/**
 * Picks the next chunk size based on recent speed samples.
 *
 * @param {number[]} samples
 * @returns {number}
 */
function nextChunkSize(samples) {
    if (samples.length === 0) {
        return MIN_CHUNK;
    }
    const avg = samples.reduce((total, val) => total + val, 0) / samples.length;
    if (avg < SLOW_SPEED) {
        return MIN_CHUNK;
    }
    if (avg < MEDIUM_SPEED) {
        return MED_CHUNK;
    }
    if (avg < FAST_SPEED) {
        return LARGE_CHUNK;
    }
    return MAX_CHUNK;
}

/**
 * Downloads a byte range from a Bunny CDN font file and measures speed.
 *
 * @param {string} url
 * @param {number} chunkBytes
 * @param {number} timeoutMs
 * @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>}
 */
async function downloadRange(url, chunkBytes, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        Math.min(timeoutMs, FETCH_TIMEOUT_MS)
    );
    try {
        const cacheBust = url.includes('?') ? '&' : '?';
        const finalUrl = `${url}${cacheBust}_=${Date.now()}`;
        const t0 = performance.now();
        const resp = await fetch(finalUrl, {
            signal: controller.signal,
            cache: 'no-store',
            headers: { Range: `bytes=0-${chunkBytes - 1}` },
        });
        if (!resp.ok && resp.status !== HTTP_PARTIAL_CONTENT) {
            return zeroSample();
        }
        await resp.blob();
        const dur = performance.now() - t0;
        const bytes = getTransferBytes(finalUrl, chunkBytes);
        if (bytes === 0) {
            return zeroSample();
        }
        return { bytes, speedMbps: bytesToMbps(bytes, dur), durationMs: dur };
    } catch {
        return zeroSample();
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * @param {{ status: string, speedMbps: number|null, durationMs: number,
 *   bytesTransferred: number, errorMessage: string|null }} opts
 * @returns {import('../lib/types.js').TestResult}
 */
function buildResult({ status, speedMbps, durationMs, bytesTransferred,
    errorMessage }) {
    return {
        targetName: 'Bunny CDN', pluginId: 'bunny-cdn',
        status, downloadSpeedMbps: speedMbps,
        durationMs, bytesTransferred, errorMessage,
        timestamp: new Date().toISOString(),
    };
}

// === Plugin ===

const bunnyCdnPlugin = {
    id: 'bunny-cdn',
    name: 'Bunny CDN',
    description: 'Download speed from Bunny CDN (fonts.bunny.net)',
    category: 'cdn',

    async run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs || SAMPLE_DURATION_MS;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
        const samples = [];
        let totalBytes = 0;

        try {
            let idx = 0;
            while (performance.now() - startTime < sampleDuration) {
                if (performance.now() - startTime > timeoutMs) {
                    break;
                }
                const url = BUNNY_FONT_URLS[idx % BUNNY_FONT_URLS.length];
                const size = nextChunkSize(samples);
                const sample = await downloadRange(url, size, timeoutMs);
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
                status: 'error', speedMbps: null,
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage: error.message || 'Unknown error',
            });
        }
    },
};

registerPlugin(bunnyCdnPlugin);
export { bunnyCdnPlugin };
