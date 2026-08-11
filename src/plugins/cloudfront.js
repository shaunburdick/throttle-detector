/**
 * AWS CloudFront CDN speed test plugin.
 *
 * Downloads an AWS whitepaper from d1.awsstatic.com (AWS's own public
 * CloudFront distribution) using byte-range requests, measuring throughput
 * over a time-bounded sampling window.
 *
 * @module plugins/cloudfront
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import { bytesToMbps, trimmedMean } from '../lib/utils.js';

/** Primary test file served from CloudFront */
const CLOUDFRONT_BASE = 'https://d1.awsstatic.com/whitepapers/aws-overview.pdf';

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

/** Mid-range chunk sizes used as adaptive steps. */
const MED_CHUNK = 512 * KIB;
const LARGE_CHUNK = 2 * MIB;

// === Helpers (function declarations hoist) ===

/** @returns {{bytes: number, speedMbps: number, durationMs: number}} */
function zeroSample() {
    return { bytes: 0, speedMbps: 0, durationMs: 0 };
}

/**
 * Returns the actual bytes transferred using the Resource Timing API.
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
    return Math.min(MAX_CHUNK, 10 * MIB);
}

/**
 * Downloads a byte range from the CloudFront endpoint and measures speed.
 *
 * @param {string} baseUrl
 * @param {number} chunkBytes
 * @param {number} timeoutMs
 * @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>}
 */
async function downloadRange(baseUrl, chunkBytes, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        Math.min(timeoutMs, FETCH_TIMEOUT_MS)
    );
    try {
        const url = `${baseUrl}?_=${Date.now()}`;
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
 * @param {{ status: string, speedMbps: number|null, durationMs: number,
 *   bytesTransferred: number, errorMessage: string|null }} opts
 * @returns {import('../lib/types.js').TestResult}
 */
function buildResult({ status, speedMbps, durationMs, bytesTransferred,
    errorMessage }) {
    return {
        targetName: 'AWS CloudFront', pluginId: 'cloudfront',
        status, downloadSpeedMbps: speedMbps,
        durationMs, bytesTransferred, errorMessage,
        timestamp: new Date().toISOString(),
    };
}

// === Plugin ===

const cloudfrontPlugin = {
    id: 'cloudfront',
    name: 'AWS CloudFront',
    description: 'Download speed from AWS CloudFront CDN (d1.awsstatic.com)',
    category: 'cdn',

    async run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs || SAMPLE_DURATION_MS;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
        const samples = [];
        let totalBytes = 0;

        try {
            while (performance.now() - startTime < sampleDuration) {
                if (performance.now() - startTime > timeoutMs) {
                    break;
                }
                const size = nextChunkSize(samples);
                const sample = await downloadRange(
                    CLOUDFRONT_BASE, size, timeoutMs
                );
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

registerPlugin(cloudfrontPlugin);
export { cloudfrontPlugin };
