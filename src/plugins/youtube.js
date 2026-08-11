/**
 * YouTube / Google CDN speed test plugin.
 *
 * Downloads large CJK font files from fonts.gstatic.com (Google Fonts CDN).
 * Each font file is 5–10 MB — large enough for meaningful throughput
 * measurement on high-speed connections.
 *
 * The YouTube video CDN (googlevideo.com) is CORS-blocked from browser
 * JavaScript, so this plugin uses Google Fonts CDN edge servers — the
 * same Google global CDN infrastructure — as a practical alternative.
 *
 * @module plugins/youtube
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import { bytesToMbps, trimmedMean } from '../lib/utils.js';

/**
 * Large CJK font files (TTF) from fonts.gstatic.com.
 * Each is 5–10 MB and includes CORS + Timing-Allow-Origin headers.
 *
 * Using multiple fonts spreads cache pressure across different CDN
 * edge locations and prevents repeated cache hits from masking real
 * network throughput. Font URLs are sourced from the Google Fonts
 * CSS API (fonts.googleapis.com/css2) to ensure valid, stable URLs.
 */
const GSTATIC_FONT_URLS = [
    'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf',
    'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGzjCnYw.ttf',
    'https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf',
    'https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk75s.ttf',
    'https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLQ.ttf',
    'https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzg01eLQ.ttf',
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
 * Returns actual transfer bytes from the Resource Timing API
 * using O(1) lookup by exact URL.
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
 * Downloads a font file from Google Fonts CDN and measures speed.
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
        // Capture Content-Length before consuming body — fallback for
        // CDNs that don't set Timing-Allow-Origin (fonts.gstatic.com).
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
        targetName: 'YouTube CDN',
        pluginId: 'youtube',
        status,
        downloadSpeedMbps: speedMbps,
        durationMs,
        bytesTransferred,
        errorMessage,
        timestamp: new Date().toISOString(),
        category: 'streaming',
    };
}

// === Plugin ===

const youtubePlugin = {
    id: 'youtube',
    name: 'YouTube CDN',
    description: 'Download speed from Google CDN (fonts.gstatic.com large CJK fonts)',
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

registerPlugin(youtubePlugin);
export { youtubePlugin };
