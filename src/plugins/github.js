/**
 * GitHub CDN speed test plugin.
 *
 * Downloads a known binary test file from raw.githubusercontent.com
 * (backed by Fastly CDN) using byte-range requests, measuring throughput
 * over a time-bounded sampling window.
 *
 * The test file lives in this project's own repository, guaranteeing
 * availability as long as the repo exists.
 *
 * @module plugins/github
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import { bytesToMbps, trimmedMean } from '../lib/utils.js';

// === URLs ===

/** Primary: our own repo's 25 MiB test asset. Always available. */
const PRIMARY_URL = 'https://raw.githubusercontent.com/shaunburdick/throttle-detector/main/test-assets/25mb.bin';

/**
 * Fallback: a larger file from a well-known public repo (Three.js).
 * Only used if the primary file is unavailable.
 */
const FALLBACK_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/r170/build/three.min.js';

// === Sampling constants ===

const SAMPLE_DURATION_MS = 10000;
const WARMUP_DURATION_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;
const KIB = 1024;
const MIB = 1024 * 1024;
const MIN_CHUNK = 64 * KIB;
const MAX_CHUNK = 25 * MIB;

/** Speed thresholds (Mbps) for adaptive chunk sizing. */
const SLOW_SPEED = 5;
const MEDIUM_SPEED = 50;
const FAST_SPEED = 200;

/** HTTP 206 Partial Content — expected when using Range requests. */
const HTTP_PARTIAL_CONTENT = 206;

/** Mid-range adaptive chunk sizes. */
const MED_CHUNK = 512 * KIB;
const LARGE_CHUNK = 2 * MIB;

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
    return Math.min(MAX_CHUNK, 10 * MIB);
}

/**
 * Downloads a byte range and returns timing information.
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
        const t0 = performance.now();
        const resp = await fetch(url, {
            signal: controller.signal,
            cache: 'no-store',
            headers: { Range: `bytes=0-${chunkBytes - 1}` },
        });
        if (!resp.ok && resp.status !== HTTP_PARTIAL_CONTENT) {
            return zeroSample();
        }
        await resp.blob();
        const dur = performance.now() - t0;
        const bytes = getTransferBytes(url, chunkBytes);
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
 * Probes the primary URL to verify it's accessible. Falls back to the
 * secondary URL if the probe fails.
 *
 * @returns {Promise<string>}
 */
async function resolveTestUrl() {
    const probeCtrl = new AbortController();
    const probeTimeout = setTimeout(
        () => probeCtrl.abort(), FETCH_TIMEOUT_MS
    );
    try {
        const probeResp = await fetch(
            `${PRIMARY_URL}?probe=1`,
            {
                signal: probeCtrl.signal,
                cache: 'no-store',
                headers: { Range: 'bytes=0-0' },
            }
        );
        if (!probeResp.ok && probeResp.status !== HTTP_PARTIAL_CONTENT) {
            return FALLBACK_URL;
        }
        return PRIMARY_URL;
    } catch {
        return FALLBACK_URL;
    } finally {
        clearTimeout(probeTimeout);
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
        targetName: 'GitHub (Fastly)', pluginId: 'github',
        status, downloadSpeedMbps: speedMbps,
        durationMs, bytesTransferred, errorMessage,
        timestamp: new Date().toISOString(),
    };
}

// === Plugin ===

const githubPlugin = {
    id: 'github',
    name: 'GitHub (Fastly)',
    description: 'Download speed from GitHub raw CDN (raw.githubusercontent.com)',
    category: 'cdn',

    async run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs || SAMPLE_DURATION_MS;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
        const samples = [];
        let totalBytes = 0;

        try {
            const testUrl = await resolveTestUrl();

            while (performance.now() - startTime < sampleDuration) {
                if (performance.now() - startTime > timeoutMs) {
                    break;
                }
                const size = nextChunkSize(samples);
                const sample = await downloadRange(testUrl, size, timeoutMs);
                totalBytes += sample.bytes;
                if (sample.speedMbps > 0
                    && performance.now() - startTime > WARMUP_DURATION_MS) {
                    samples.push(sample.speedMbps);
                }
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

registerPlugin(githubPlugin);
export { githubPlugin };
