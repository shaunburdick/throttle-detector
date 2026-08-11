/**
 * Plugin Runner — shared helpers for test plugin modules.
 *
 * Extracts ~70% duplicated code from the 6 plugins into reusable factories
 * and download primitives. Each plugin now only needs ~30-40 lines of
 * unique config + URL-specific download logic.
 *
 * @module lib/plugin-runner
 */

import { bytesToMbps, trimmedMean } from './utils.js';

// ===== Shared Constants =====

/** Default sampling window duration (ms) */
export const DEFAULT_SAMPLE_DURATION = 10000;

/** Warmup period before collecting speed samples (ms) */
export const DEFAULT_WARMUP_DURATION = 1000;

/** Default overall plugin timeout (ms) */
export const DEFAULT_TIMEOUT = 30000;

/** Per-fetch timeout ceiling (ms) */
export const PER_FETCH_TIMEOUT = 15000;

const KIB = 1024;
const MIB = 1024 * 1024;

/** Range-request adaptive sizing defaults */
const DEFAULT_MIN_CHUNK = 64 * KIB;
const DEFAULT_MAX_CHUNK = 25 * MIB;
const DEFAULT_MID_CHUNK = 512 * KIB;
const DEFAULT_LARGE_CHUNK = 2 * MIB;
const DEFAULT_MAX_FAST = 10 * MIB;
const DEFAULT_SLOW_THRESHOLD = 5;
const DEFAULT_MEDIUM_THRESHOLD = 50;
const DEFAULT_FAST_THRESHOLD = 200;

// ===== Sample Result Helpers =====

/** @returns {{bytes: number, speedMbps: number, durationMs: number}} */
export function zeroSample() {
    return { bytes: 0, speedMbps: 0, durationMs: 0 };
}

// ===== buildResult Factory =====

/**
 * Creates a `buildResult` function for a specific plugin.
 *
 * Eliminates 6 near-identical module-level `buildResult` functions.
 *
 * @param {{ pluginId: string, targetName: string, category: string }} opts
 * @returns {function({
 *   status: string, speedMbps: number|null, durationMs: number,
 *   bytesTransferred: number, errorMessage: string|null
 * }): import('./types.js').TestResult}
 */
export function createBuildResult({ pluginId, targetName, category }) {
    return function buildResult({ status, speedMbps, durationMs,
        bytesTransferred, errorMessage }) {
        return {
            targetName,
            pluginId,
            category,
            status,
            downloadSpeedMbps: speedMbps,
            durationMs,
            bytesTransferred,
            errorMessage,
            timestamp: new Date().toISOString(),
        };
    };
}

// ===== Full-File Download Helper =====

/**
 * Downloads an entire file via fetch and measures throughput.
 *
 * Uses Resource Timing API (getEntriesByName) for accurate byte counts
 * with O(1) lookup, falling back to Content-Length header.
 *
 * @param {{ url: string, timeoutMs: number }} opts
 * @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>}
 */
export async function downloadFullFile({ url, timeoutMs }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        Math.min(timeoutMs, PER_FETCH_TIMEOUT)
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
        const cl = resp.headers.get('content-length');
        const contentLength = cl ? parseInt(cl, 10) : 0;
        await resp.blob();
        const dur = performance.now() - t0;

        // O(1) lookup via exact URL match
        const entries = performance.getEntriesByName(cacheBust);
        let bytes = contentLength;
        if (entries.length > 0) {
            const entry = entries[entries.length - 1];
            bytes = entry.transferSize || entry.encodedBodySize || contentLength;
        }
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

// ===== Range-Request Download Helper =====

/**
 * Downloads a byte range from a CDN endpoint and measures speed.
 *
 * Shared by CloudFront and GitHub plugins. Uses blob.size for byte
 * counting because Resource Timing transferSize can report full file
 * size for Range responses, inflating speed measurements.
 *
 * @param {{ url: string, chunkBytes: number, timeoutMs: number,
 *   httpPartialContent?: number }} opts
 * @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>}
 */
export async function downloadRange({ url, chunkBytes, timeoutMs,
    httpPartialContent = 206 }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        Math.min(timeoutMs, PER_FETCH_TIMEOUT)
    );
    try {
        const cacheBust = `${url}?_=${Date.now()}`;
        const t0 = performance.now();
        const resp = await fetch(cacheBust, {
            signal: controller.signal,
            cache: 'no-store',
            headers: { Range: `bytes=0-${chunkBytes - 1}` },
        });
        if (!resp.ok && resp.status !== httpPartialContent) {
            return zeroSample();
        }
        const blob = await resp.blob();
        const dur = performance.now() - t0;
        // Use blob.size — Resource Timing transferSize may report full file
        const bytes = blob.size;
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

// ===== Adaptive Chunk Sizing (Range requests) =====

/**
 * Resolves threshold config with defaults for adaptive chunk sizing.
 *
 * @param {object} [opts]
 * @returns {{ minChunk: number, maxChunk: number, thresholds: Array<{max: number, size: number}>, maxFast: number }}
 */
function resolveRangeConfig(opts = {}) {
    const minChunk = opts.minChunk ?? DEFAULT_MIN_CHUNK;
    const maxChunk = opts.maxChunk ?? DEFAULT_MAX_CHUNK;
    const maxFast = opts.maxFast ?? DEFAULT_MAX_FAST;
    const thresholds = [
        {
            max: opts.slowThreshold ?? DEFAULT_SLOW_THRESHOLD,
            size: opts.midChunk ?? DEFAULT_MID_CHUNK,
        },
        {
            max: opts.mediumThreshold ?? DEFAULT_MEDIUM_THRESHOLD,
            size: opts.largeChunk ?? DEFAULT_LARGE_CHUNK,
        },
        {
            max: opts.fastThreshold ?? DEFAULT_FAST_THRESHOLD,
            size: maxFast,
        },
    ];
    return { minChunk, maxChunk, thresholds, maxFast };
}

/**
 * Computes the average of a non-empty array of numbers.
 *
 * @param {number[]} values
 * @returns {number}
 */
function sampleAvg(values) {
    return values.reduce((total, val) => total + val, 0) / values.length;
}

/**
 * Picks the next Range-request chunk size based on recent speed samples.
 *
 * Shared by CloudFront and GitHub plugins. Uses data-driven thresholds
 * to scale chunks from 64 KiB to 25 MiB based on connection speed.
 *
 * @param {number[]} samples - Recent speed measurements (Mbps)
 * @param {object} [opts] - Optional threshold overrides
 * @returns {number} Next chunk size in bytes
 */
export function adaptRangeChunkSize(samples, opts = {}) {
    const { minChunk, maxChunk, thresholds, maxFast } = resolveRangeConfig(opts);
    if (samples.length === 0) {
        return minChunk;
    }
    const avg = sampleAvg(samples);
    if (avg < thresholds[0].max) {
        return minChunk;
    }
    for (const bucket of thresholds) {
        if (avg < bucket.max) {
            return bucket.size;
        }
    }
    return Math.min(maxChunk, maxFast);
}

// ===== URL-Based Run Loop Factory =====

/**
 * Creates a run() function for URL-cycling plugins.
 *
 * Shared by YouTube, jsDelivr, and Bunny CDN plugins. Each calls
 * `downloadFullFile` (or a custom download function) against a rotating
 * set of URLs.
 *
 * @param {{ buildResult: Function, urls: string[],
 *   downloadFn: Function }} opts
 * @returns {function(import('./types.js').TestConfig):
 *   Promise<import('./types.js').TestResult>}
 */
export function createUrlBasedRunLoop({ buildResult, urls, downloadFn }) {
    return async function run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs
            || DEFAULT_SAMPLE_DURATION;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT;
        const samples = [];
        let totalBytes = 0;

        try {
            let idx = 0;
            while (performance.now() - startTime < sampleDuration) {
                if (performance.now() - startTime > timeoutMs) {
                    break;
                }
                const url = urls[idx % urls.length];
                const sample = await downloadFn({ url, timeoutMs });
                totalBytes += sample.bytes;
                if (sample.speedMbps > 0
                    && performance.now() - startTime
                        > DEFAULT_WARMUP_DURATION) {
                    samples.push(sample.speedMbps);
                }
                idx += 1;
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
    };
}

// ===== Range-Based Run Loop Factory =====

/**
 * Creates a run() function for Range-request plugins.
 *
 * Shared by CloudFront and GitHub plugins. Uses adaptive chunk sizing
 * with Range requests.
 *
 * @param {{ buildResult: Function, resolveUrl: Function,
 *   downloadFn: Function, adaptiveFn: Function }} opts
 * @returns {function(import('./types.js').TestConfig):
 *   Promise<import('./types.js').TestResult>}
 */
export function createRangeBasedRunLoop({ buildResult, resolveUrl,
    downloadFn, adaptiveFn }) {
    return async function run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs
            || DEFAULT_SAMPLE_DURATION;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT;
        const samples = [];
        let totalBytes = 0;

        try {
            const baseUrl = await resolveUrl();

            while (performance.now() - startTime < sampleDuration) {
                if (performance.now() - startTime > timeoutMs) {
                    break;
                }
                const size = adaptiveFn ? adaptiveFn(samples) : undefined;
                const sample = await downloadFn({
                    url: baseUrl, chunkBytes: size, timeoutMs,
                });
                totalBytes += sample.bytes;
                if (sample.speedMbps > 0
                    && performance.now() - startTime
                        > DEFAULT_WARMUP_DURATION) {
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
                status: 'error',
                speedMbps: null,
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage: error.message || 'Unknown error',
            });
        }
    };
}
