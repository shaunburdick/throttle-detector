/**
 * fast.com (Netflix) speed test plugin.
 *
 * @module plugins/fast-com
 */

import { registerPlugin } from '../lib/plugin-registry.js';

const FAST_COM_URL = 'https://fast.com/';
const API_BASE = 'https://api.fast.com/netflix/speedtest/v2';
const SAMPLE_DURATION_MS = 10000;
const WARMUP_DURATION_MS = 1000;
const BYTES_PER_SECOND = 1000;
const BITS_PER_BYTE = 8;
const BYTES_PER_MILLION = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30000;
const KIB = 1024;
const MIB = 1024 * 1024;
const OUTLIER_TRIM_RATIO = 0.1;
const MIN_SAMPLES = 3;
const SLOW_SPEED = 5;
const MEDIUM_SPEED = 50;
const FAST_SPEED = 200;
const SMALL_PROBE = 128 * KIB;
const INITIAL_PROBE = 256 * KIB;

// === Helpers (function declarations hoist) ===

/**
 * @param {string} token
 * @param {number} timeoutMs
 * @returns {Promise<string[]|null>}
 */
async function getOcaUrls(token, timeoutMs) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const url = `${API_BASE}?https=true&token=${token}&urlCount=5`;
        const resp = await fetch(url, { signal: ctrl.signal });
        const data = await resp.json();
        if (data && Array.isArray(data.targets)) {
            return data.targets.map((target) => target.url).filter(Boolean);
        }
        return null;
    } catch {
        return null;
    } finally {
        clearTimeout(tid);
    }
}

/**
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
async function extractToken(timeoutMs) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const htmlResp = await fetch(FAST_COM_URL, { signal: ctrl.signal });
        const html = await htmlResp.text();
        const sm = html.match(/<script[^>]*src="([^"]*app[^"]*\.js)"/i);
        if (!sm) {
            return null;
        }
        const appJsUrl = sm[1].startsWith('http') ? sm[1] : `https://fast.com${sm[1]}`;
        const jsResp = await fetch(appJsUrl, { signal: ctrl.signal });
        const jsText = await jsResp.text();
        const tm = jsText.match(/token\s*[:=]\s*["']([A-Za-z0-9_-]{20,})["']/);
        return tm ? tm[1] : null;
    } catch {
        return null;
    } finally {
        clearTimeout(tid);
    }
}

/** @param {string} urlStart @param {number} fallback @returns {number} */
function getActualBytes(urlStart, fallback) {
    const entries = performance.getEntriesByType('resource');
    const prefix = urlStart.split('?')[0].split('range/')[0];
    for (const entry of entries) {
        if (entry.name.startsWith(prefix)) {
            if (entry.transferSize > 0) {
                return entry.transferSize;
            }
            if (entry.encodedBodySize > 0) {
                return entry.encodedBodySize;
            }
            break;
        }
    }
    return fallback;
}

/**
 * @param {{ url: string, expectedBytes: number, timeoutMs: number }} opts
 * @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>}
 */
async function downloadFromOca({ url, expectedBytes, timeoutMs }) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const t0 = performance.now();
        const resp = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (!resp.ok) {
            return { bytes: 0, speedMbps: 0, durationMs: 0 };
        }
        await resp.blob();
        const dur = performance.now() - t0;
        const bytes = getActualBytes(url, expectedBytes);
        const bps = bytes / (dur / BYTES_PER_SECOND);
        return { bytes, speedMbps: (bps * BITS_PER_BYTE) / BYTES_PER_MILLION, durationMs: dur };
    } catch {
        return { bytes: 0, speedMbps: 0, durationMs: 0 };
    } finally {
        clearTimeout(tid);
    }
}

/** @param {number[]} samples @returns {number} */
function pickChunkSize(samples) {
    if (samples.length === 0) {
        return INITIAL_PROBE;
    }
    const avg = samples.reduce((total, value) => total + value, 0)
        / samples.length;
    if (avg < SLOW_SPEED) {
        return SMALL_PROBE;
    }
    if (avg < MEDIUM_SPEED) {
        return 1 * MIB;
    }
    if (avg < FAST_SPEED) {
        return 5 * MIB;
    }
    return 15 * MIB;
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
    const tc = Math.max(1, Math.floor(samples.length * OUTLIER_TRIM_RATIO));
    const trimmed = sorted.slice(tc, sorted.length - tc);
    if (trimmed.length === 0) {
        return sorted.reduce((total, value) => total + value, 0)
            / sorted.length;
    }
    return trimmed.reduce((total, value) => total + value, 0)
        / trimmed.length;
}

/**
 * @param {{ status: string, speedMbps: number|null, durationMs: number,
 *   bytesTransferred: number, errorMessage: string|null }} opts
 * @returns {import('../lib/types.js').TestResult}
 */
function buildResult({ status, speedMbps, durationMs, bytesTransferred,
    errorMessage }) {
    return {
        targetName: 'Fast.com (Netflix)', pluginId: 'fast-com',
        status, downloadSpeedMbps: speedMbps,
        durationMs, bytesTransferred, errorMessage,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Acquires OCA URLs for download testing.
 *
 * @param {number} timeoutMs
 * @returns {Promise<{urls: string[]|null, error: string|null}>}
 */
async function acquireOcaUrls(timeoutMs) {
    const token = await extractToken(timeoutMs);
    if (!token) {
        return { urls: null, error: 'Could not reach fast.com API'
            + ' \u2014 token extraction failed' };
    }
    const urls = await getOcaUrls(token, timeoutMs);
    if (!urls || urls.length === 0) {
        return { urls: null, error: 'Could not get OCA URLs'
            + ' from fast.com API' };
    }
    return { urls, error: null };
}

/**
 * Runs the sampling loop against OCA URLs.
 *
 * @param {{ urls: string[], startTime: number, sampleDuration: number,
 *   timeoutMs: number }} opts
 * @returns {Promise<{samples: number[], totalBytes: number}>}
 */
async function runSamplingLoop({
    urls, startTime, sampleDuration, timeoutMs,
}) {
    const samples = [];
    let totalBytes = 0;
    let idx = 0;

    while (performance.now() - startTime < sampleDuration) {
        if (performance.now() - startTime > timeoutMs) {
            break;
        }
        const baseUrl = urls[idx % urls.length];
        const chunkSize = pickChunkSize(samples);
        const rangeUrl = baseUrl.replace(
            /range\/\d+-\d+/, `range/0-${chunkSize - 1}`
        );
        const sample = await downloadFromOca({
            url: rangeUrl, expectedBytes: chunkSize, timeoutMs,
        });
        totalBytes += sample.bytes;
        if (sample.speedMbps > 0
            && performance.now() - startTime > WARMUP_DURATION_MS) {
            samples.push(sample.speedMbps);
        }
        idx++;
    }
    return { samples, totalBytes };
}

const fastComPlugin = {
    id: 'fast-com',
    name: 'Fast.com (Netflix)',
    description: 'Download speed from Netflix Open Connect CDN',
    category: 'streaming',

    async run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs || SAMPLE_DURATION_MS;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;

        try {
            const { urls, error: setupError } = await acquireOcaUrls(
                timeoutMs
            );
            if (setupError) {
                return buildResult({
                    status: 'error', speedMbps: null,
                    durationMs: Math.round(performance.now() - startTime),
                    bytesTransferred: 0,
                    errorMessage: setupError,
                });
            }

            const { samples, totalBytes } = await runSamplingLoop({
                urls, startTime, sampleDuration, timeoutMs,
            });

            return buildResult({
                status: 'success', speedMbps: computeFinalSpeed(samples),
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage: computeFinalSpeed(samples) === null
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

registerPlugin(fastComPlugin);
export { fastComPlugin };
