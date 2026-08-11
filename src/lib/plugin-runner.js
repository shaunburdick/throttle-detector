/**
 * Plugin Runner — shared helpers for test plugin modules.
 *
 * Extracts ~70% duplicated code from the 6 plugins into reusable factories
 * and download primitives. Each plugin now only needs ~30-40 lines of
 * unique config + URL-specific download logic.
 *
 * @module lib/plugin-runner
 */

import { bytesToMbps, trimmedMean, average } from './utils.js';

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
const DEFAULT_RANGE_CONFIG = Object.freeze({
    minChunk: 64 * KIB,
    maxChunk: 25 * MIB,
    midChunk: 512 * KIB,
    largeChunk: 2 * MIB,
    maxFast: 10 * MIB,
    buckets: Object.freeze([
        Object.freeze({ max: 5, size: 64 * KIB }),
        Object.freeze({ max: 50, size: 512 * KIB }),
        Object.freeze({ max: 200, size: 2 * MIB }),
    ]),
});

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

// ===== Fetch Timeout Wrapper =====

/**
 * Wraps an async fetch operation with an AbortController timeout.
 *
 * Eliminates ~10 lines of AbortController + setTimeout +
 * try/catch/finally boilerplate from both downloadFullFile and
 * downloadRange.
 *
 * @param {number} timeoutMs - Overall timeout in milliseconds
 * @param {(signal: AbortSignal) => Promise<T>} fn - Fetch operation
 * @returns {Promise<T|ReturnType<typeof zeroSample>>}
 * @template T
 */
export async function withFetchTimeout(timeoutMs, fn) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        Math.min(timeoutMs, PER_FETCH_TIMEOUT)
    );
    try {
        return await fn(controller.signal);
    } catch {
        return zeroSample();
    } finally {
        clearTimeout(timeoutId);
    }
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
    return withFetchTimeout(timeoutMs, async (signal) => {
        const cacheBust = `${url}?_=${Date.now()}`;
        const t0 = performance.now();
        const resp = await fetch(cacheBust, {
            signal,
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
    });
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
    return withFetchTimeout(timeoutMs, async (signal) => {
        const cacheBust = `${url}?_=${Date.now()}`;
        const t0 = performance.now();
        const resp = await fetch(cacheBust, {
            signal,
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
    });
}

// ===== Adaptive Chunk Sizing (Range requests) =====

/**
 * Resolves threshold config with defaults for adaptive chunk sizing.
 *
 * Accepts both a `buckets` array (pre-built {max, size} objects) and
 * legacy individual threshold overrides (slowThreshold, mediumThreshold,
 * fastThreshold, midChunk, largeChunk).
 *
 * @param {object} [opts]
 * @returns {{ minChunk: number, maxChunk: number, buckets: Array<{max: number, size: number}>, maxFast: number }}
 */
function resolveRangeConfig(opts = {}) {
    const defaults = DEFAULT_RANGE_CONFIG;
    const {
        minChunk = defaults.minChunk,
        maxChunk = defaults.maxChunk,
        maxFast = defaults.maxFast,
        buckets: bucketsOverride,
        slowThreshold, mediumThreshold, fastThreshold,
        midChunk, largeChunk,
    } = opts;
    let buckets = bucketsOverride;
    if (!buckets) {
        // Legacy support: individual threshold and chunk size overrides
        const slow = slowThreshold ?? defaults.buckets[0].max;
        const medium = mediumThreshold ?? defaults.buckets[1].max;
        const fast = fastThreshold ?? defaults.buckets[2].max;
        const mid = midChunk ?? defaults.buckets[1].size;
        const large = largeChunk ?? defaults.buckets[2].size;
        buckets = [
            { max: slow, size: minChunk },
            { max: medium, size: mid },
            { max: fast, size: large },
        ];
    }
    return { minChunk, maxChunk, buckets, maxFast };
}

/**
 * Picks the next Range-request chunk size based on recent speed samples.
 *
 * Shared by CloudFront and GitHub plugins. Uses data-driven thresholds
 * to scale chunks from 64 KiB to 25 MiB based on connection speed.
 *
 * @param {number[]} samples - Recent speed measurements (Mbps)
 * @param {object} [opts] - Optional threshold overrides (buckets array)
 * @returns {number} Next chunk size in bytes
 */
export function adaptRangeChunkSize(samples, opts = {}) {
    const { minChunk, maxChunk, buckets, maxFast } = resolveRangeConfig(opts);
    if (samples.length === 0) {
        return minChunk;
    }
    const avg = /** @type {number} */ (average(samples));
    for (const bucket of buckets) {
        if (avg < bucket.max) {
            return bucket.size;
        }
    }
    return Math.min(maxChunk, maxFast);
}

// ===== Unified Run Loop Factory =====

/**
 * Shared result builder for all run loop factories.
 *
 * @param {{ buildResult: Function, startTime: number,
 *   totalBytes: number, samples: number[] }} opts
 * @returns {import('./types.js').TestResult}
 */
function finalizeRun({ buildResult, startTime, totalBytes, samples }) {
    const speed = trimmedMean(samples);
    return buildResult({
        status: speed !== null ? 'success' : 'error',
        speedMbps: speed,
        durationMs: Math.round(performance.now() - startTime),
        bytesTransferred: totalBytes,
        errorMessage: speed === null
            ? 'Not enough valid samples collected' : null,
    });
}

/**
 * Creates a unified run() function for all plugin types.
 *
 * The `nextSample` parameter is a factory function that returns a
 * per-run sample strategy — a closure that captures mutable state
 * (URL cycling index, lazy-resolved base URL, chunk index, etc.).
 *
 * @param {{ buildResult: Function,
 *   nextSample: () => (opts: { samples: number[], timeoutMs: number })
 *     => Promise<{bytes: number, speedMbps: number, durationMs: number}>
 * }} opts
 * @returns {function(import('./types.js').TestConfig):
 *   Promise<import('./types.js').TestResult>}
 */
function createRunLoop({ buildResult, nextSample }) {
    return async function run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs
            || DEFAULT_SAMPLE_DURATION;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT;
        const samples = [];
        let totalBytes = 0;

        try {
            const getSample = nextSample();
            while (performance.now() - startTime < sampleDuration) {
                if (performance.now() - startTime > timeoutMs) {
                    break;
                }
                const sample = await getSample({ samples, timeoutMs });
                totalBytes += sample.bytes;
                if (sample.speedMbps > 0
                    && performance.now() - startTime
                        > DEFAULT_WARMUP_DURATION) {
                    samples.push(sample.speedMbps);
                }
            }
            return finalizeRun({ buildResult, startTime, totalBytes, samples });
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

// ===== URL-Based Run Loop Factory =====

/**
 * Creates a run() function for URL-cycling plugins.
 *
 * Thin wrapper around the unified `createRunLoop` factory. Shared by
 * YouTube, jsDelivr, and Bunny CDN plugins.
 *
 * @param {{ buildResult: Function, urls: string[],
 *   downloadFn: Function }} opts
 * @returns {function(import('./types.js').TestConfig):
 *   Promise<import('./types.js').TestResult>}
 */
export function createUrlBasedRunLoop({ buildResult, urls, downloadFn }) {
    if (!urls || urls.length === 0) {
        return async function run() {
            return buildResult({
                status: 'error',
                speedMbps: null,
                durationMs: 0,
                bytesTransferred: 0,
                errorMessage: 'No URLs configured for this plugin',
            });
        };
    }
    return createRunLoop({
        buildResult,
        nextSample: () => {
            let idx = 0;
            return async ({ timeoutMs }) => {
                const url = urls[idx % urls.length];
                idx += 1;
                return downloadFn({ url, timeoutMs });
            };
        },
    });
}

// ===== Range-Based Run Loop Factory =====

/**
 * Creates a run() function for Range-request plugins.
 *
 * Thin wrapper around the unified `createRunLoop` factory. Shared by
 * CloudFront and GitHub plugins.
 *
 * @param {{ buildResult: Function, resolveUrl: Function,
 *   downloadFn: Function, adaptiveFn: Function }} opts
 * @returns {function(import('./types.js').TestConfig):
 *   Promise<import('./types.js').TestResult>}
 */
export function createRangeBasedRunLoop({ buildResult, resolveUrl,
    downloadFn, adaptiveFn }) {
    return createRunLoop({
        buildResult,
        nextSample: () => {
            let baseUrlPromise = null;
            return async ({ samples, timeoutMs }) => {
                if (!baseUrlPromise) {
                    baseUrlPromise = resolveUrl();
                }
                const baseUrl = await baseUrlPromise;
                const size = adaptiveFn ? adaptiveFn(samples) : undefined;
                return downloadFn({ url: baseUrl, chunkBytes: size, timeoutMs });
            };
        },
    });
}

// ===== Chunk-Based Run Loop Factory =====

/**
 * Creates a run() function for chunk-based index-cycling plugins.
 *
 * Unlike URL-cycling or adaptive Range-based loops, this factory uses
 * a pre-configured array of chunk sizes and a `nextChunk` strategy to
 * walk through them based on sample duration. Used by Cloudflare.
 *
 * @param {{ buildResult: Function, sizes: number[],
 *   buildUrl: (size: number) => string,
 *   nextChunk: (durationMs: number, currentIndex: number, maxIndex: number) => number,
 *   downloadFn: Function }} opts
 * @returns {function(import('./types.js').TestConfig):
 *   Promise<import('./types.js').TestResult>}
 */
export function createChunkBasedRunLoop({ buildResult, sizes, buildUrl,
    nextChunk, downloadFn }) {
    const maxIndex = sizes.length - 1;
    return createRunLoop({
        buildResult,
        nextSample: () => {
            let chunkIndex = 0;
            return async ({ timeoutMs }) => {
                const sz = sizes[Math.min(chunkIndex, maxIndex)];
                const url = buildUrl(sz);
                const sample = await downloadFn({ url, expectedBytes: sz, timeoutMs });
                chunkIndex = nextChunk(sample.durationMs, chunkIndex, maxIndex);
                return sample;
            };
        },
    });
}
