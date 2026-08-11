/**
 * Bunny CDN speed test plugin.
 *
 * Downloads large CJK font files from fonts.bunny.net (Bunny CDN's
 * first-party font delivery service). Each font file is ~1 MB —
 * 45x larger than the previous 22 KB Latinate fonts — providing
 * enough data for meaningful throughput measurement.
 *
 * @module plugins/bunny-cdn
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import { bytesToMbps, trimmedMean } from '../lib/utils.js';

/**
 * Large CJK font files served from Bunny CDN's fonts.bunny.net edge.
 * Each is 0.5–1.1 MB and supports CORS + Range requests.
 *
 * Multiple URLs spread cache pressure across different CDN nodes.
 */
const BUNNY_FONT_URLS = [
    'https://fonts.bunny.net/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2',
    'https://fonts.bunny.net/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2',
    'https://fonts.bunny.net/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff2',
    'https://fonts.bunny.net/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2',
    'https://fonts.bunny.net/noto-sans-tc/files/noto-sans-tc-chinese-traditional-400-normal.woff2',
];

const SAMPLE_DURATION_MS = 10000;
const WARMUP_DURATION_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;

// === Helpers (function declarations hoist) ===

/** @returns {{bytes: number, speedMbps: number, durationMs: number}} */
function zeroSample() {
    return { bytes: 0, speedMbps: 0, durationMs: 0 };
}

/**
 * Returns actual transfer bytes, preferring the Resource Timing API
 * with O(1) lookup by exact URL. Falls back to response Content-Length
 * when Timing-Allow-Origin is not present (fonts.bunny.net does not
 * set this header).
 *
 * @param {string} url - Exact URL including cache-bust query param
 * @param {number} fallback - Content-Length from response headers
 * @returns {number}
 */
function getTransferBytes(url, fallback) {
    const entries = performance.getEntriesByName(url);
    if (entries.length === 0) {
        return fallback;
    }
    const entry = entries[entries.length - 1];
    if (entry.transferSize > 0) {
        return entry.transferSize;
    }
    if (entry.encodedBodySize > 0) {
        return entry.encodedBodySize;
    }
    return fallback;
}

/**
 * Downloads a font file from Bunny CDN and measures speed.
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
        const cacheBust = `${url}?_=${Date.now()}`;
        const t0 = performance.now();
        const resp = await fetch(cacheBust, {
            signal: controller.signal,
            cache: 'no-store',
        });
        if (!resp.ok) {
            return zeroSample();
        }
        // Read Content-Length before consuming body (for Resource Timing fallback)
        const cl = resp.headers.get('content-length');
        const contentLength = cl ? parseInt(cl, 10) : 0;
        await resp.blob();
        const dur = performance.now() - t0;
        const bytes = getTransferBytes(cacheBust, contentLength);
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
        targetName: 'Bunny CDN',
        pluginId: 'bunny-cdn',
        status,
        downloadSpeedMbps: speedMbps,
        durationMs,
        bytesTransferred,
        errorMessage,
        timestamp: new Date().toISOString(),
        category: 'cdn',
    };
}

// === Plugin ===

const bunnyCdnPlugin = {
    id: 'bunny-cdn',
    name: 'Bunny CDN',
    description: 'Download speed from Bunny CDN (fonts.bunny.net large CJK fonts)',
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

registerPlugin(bunnyCdnPlugin);
export { bunnyCdnPlugin };
