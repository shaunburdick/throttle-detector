/**
 * YouTube / Google CDN speed test plugin.
 *
 * Downloads font files from fonts.gstatic.com (Google Fonts CDN) using
 * byte-range requests, measuring throughput over a time-bounded sampling
 * window.
 *
 * The YouTube CDN (googlevideo.com) is blocked by CORS from browser
 * JavaScript, and short-lived video URLs cannot be obtained reliably.
 * This plugin uses Google's fonts CDN edge — the same Google global
 * CDN infrastructure — as a practical alternative for measuring Google
 * CDN performance.
 *
 * @module plugins/youtube
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import { bytesToMbps, trimmedMean } from '../lib/utils.js';

/**
 * Public font file URLs served from Google Fonts CDN (fonts.gstatic.com).
 * Each is a woff2 font file (~15-200 KB) that supports Range requests
 * and has CORS headers (access-control-allow-origin: *).
 */
const GSTATIC_FONT_URLS = [
    'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.woff2',
    'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc4.woff2',
    'https://fonts.gstatic.com/s/opensans/v40/memvYaGs126MiZpBA-UvWbX2vVnXBbObj2OVTS-muw.woff2',
    'https://fonts.gstatic.com/s/opensans/v40/memvYaGs126MiZpBA-UvWbX2vVnXBbObj2OVTSumu0aC.woff2',
    'https://fonts.gstatic.com/s/lato/v24/S6uyw4BMUTPHjx4wXg.woff2',
    'https://fonts.gstatic.com/s/lato/v24/S6u9w4BMUTPHh6UVSwiPGQ.woff2',
    'https://fonts.gstatic.com/s/montserrat/v26/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Hw5aXo.woff2',
    'https://fonts.gstatic.com/s/poppins/v21/pxiEyp8kv8JHgFVrJJfecg.woff2',
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

/** Adaptive chunk sizes for font files (typically small). */
const MIN_CHUNK = 4 * KIB;
const MED_CHUNK = 16 * KIB;
const LARGE_CHUNK = 64 * KIB;
const MAX_CHUNK = 128 * KIB;

// === Helpers (function declarations hoist) ===

/** @returns {{bytes: number, speedMbps: number, durationMs: number}} */
function zeroSample() {
    return { bytes: 0, speedMbps: 0, durationMs: 0 };
}

/**
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
            return fallback;
        }
    }
    return fallback;
}

/**
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
 * Downloads a byte range from a Google Fonts CDN file.
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
        targetName: 'YouTube CDN', pluginId: 'youtube',
        status, downloadSpeedMbps: speedMbps,
        durationMs, bytesTransferred, errorMessage,
        timestamp: new Date().toISOString(),
    };
}

// === Plugin ===

const youtubePlugin = {
    id: 'youtube',
    name: 'YouTube CDN',
    description: 'Download speed from Google CDN (fonts.gstatic.com)',
    category: 'streaming',

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
                const url = GSTATIC_FONT_URLS[
                    idx % GSTATIC_FONT_URLS.length
                ];
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

registerPlugin(youtubePlugin);
export { youtubePlugin };
