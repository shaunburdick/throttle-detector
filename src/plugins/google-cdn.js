/**
 * Google CDN manufactured speed test plugin.
 *
 * @module plugins/google-cdn
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import { bytesToMbps, trimmedMean } from '../lib/utils.js';

const SAMPLE_DURATION_MS = 10000;
const WARMUP_DURATION_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;
const IMAGE_TIMEOUT_MS = 15000;

const GSTATIC_RESOURCES = [
    'https://www.gstatic.com/webp/gallery/4.jpg',
    'https://www.gstatic.com/webp/gallery/5.jpg',
    'https://www.gstatic.com/webp/gallery/3.jpg',
];

// === Helpers (function declarations hoist) ===

/** @returns {{bytes: number, speedMbps: number, durationMs: number}} */
function zeroResult() {
    return { bytes: 0, speedMbps: 0, durationMs: 0 };
}

/** @param {string} url @returns {number} */
function getEntryBytes(url) {
    const entries = performance.getEntriesByName(url);
    if (entries.length === 0) {
        return 0;
    }
    const entry = entries[entries.length - 1];
    return entry.transferSize || entry.encodedBodySize
        || entry.decodedBodySize || 0;
}

/** @returns {Promise<boolean>} */
async function probeFetch() {
    try {
        const resp = await fetch(GSTATIC_RESOURCES[0], {
            cache: 'no-store',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        return resp.ok;
    } catch {
        return false;
    }
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>}
 */
async function downloadViaFetch(url, timeoutMs) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(),
        Math.min(timeoutMs, FETCH_TIMEOUT_MS));
    try {
        const t0 = performance.now();
        const resp = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (!resp.ok) {
            return zeroResult();
        }
        await resp.blob();
        const dur = performance.now() - t0;
        const bytes = getEntryBytes(url);
        if (bytes === 0) {
            return zeroResult();
        }
        const speedMbps = bytesToMbps(bytes, dur);
        return { bytes, speedMbps, durationMs: dur };
    } catch {
        return zeroResult();
    } finally {
        clearTimeout(tid);
    }
}

/** @param {string} url @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>} */
function downloadViaImage(url) {
    return new Promise((resolve) => {
        const t0 = performance.now();
        const img = new Image();
        const tid = setTimeout(() => {
            img.src = ''; resolve(zeroResult());
        }, IMAGE_TIMEOUT_MS);
        img.onload = () => {
            clearTimeout(tid);
            const dur = performance.now() - t0;
            const bytes = getEntryBytes(url);
            if (bytes === 0 || dur === 0) {
                resolve(zeroResult()); return;
            }
            const speedMbps = bytesToMbps(bytes, dur);
            resolve({ bytes, speedMbps, durationMs: dur });
        };
        img.onerror = () => {
            clearTimeout(tid); resolve(zeroResult());
        };
        img.src = url;
    });
}

/**
 * @param {{ status: string, speedMbps: number|null, durationMs: number,
 *   bytesTransferred: number, errorMessage: string|null }} opts
 * @returns {import('../lib/types.js').TestResult}
 */
function buildResult({ status, speedMbps, durationMs, bytesTransferred,
    errorMessage }) {
    return {
        targetName: 'Google CDN', pluginId: 'google-cdn',
        status, downloadSpeedMbps: speedMbps,
        durationMs, bytesTransferred, errorMessage,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Runs the sampling loop on gstatic images.
 *
 * @param {{ fetchWorks: boolean, startTime: number, sampleDuration: number,
 *   timeoutMs: number }} opts
 * @returns {Promise<{samples: number[], totalBytes: number}>}
 */
async function runSamplingLoop({
    fetchWorks, startTime, sampleDuration, timeoutMs,
}) {
    const samples = [];
    let totalBytes = 0;
    let idx = 0;

    while (performance.now() - startTime < sampleDuration) {
        if (performance.now() - startTime > timeoutMs) {
            break;
        }
        const resourceUrl = GSTATIC_RESOURCES[
            idx % GSTATIC_RESOURCES.length
        ];
        const sep = resourceUrl.includes('?') ? '&' : '?';
        const cacheBust = `${resourceUrl}${sep}_=${Date.now()}`;
        const sample = fetchWorks
            ? await downloadViaFetch(cacheBust, timeoutMs)
            : await downloadViaImage(cacheBust);
        totalBytes += sample.bytes;
        if (sample.speedMbps > 0
            && performance.now() - startTime > WARMUP_DURATION_MS) {
            samples.push(sample.speedMbps);
        }
        idx++;
    }
    return { samples, totalBytes };
}

// === Plugin ===

const googleCdnPlugin = {
    id: 'google-cdn',
    name: 'Google CDN',
    description: 'Download speed from Google CDN infrastructure',
    category: 'manufactured',
    workerCompatible: false,

    async run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs || SAMPLE_DURATION_MS;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;

        try {
            const fetchWorks = await probeFetch();
            const { samples, totalBytes } = await runSamplingLoop({
                fetchWorks, startTime, sampleDuration, timeoutMs,
            });
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
                bytesTransferred: 0,
                errorMessage: error.message || 'Unknown error',
            });
        }
    },
};

registerPlugin(googleCdnPlugin);
export { googleCdnPlugin };
