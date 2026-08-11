/**
 * Cloudflare baseline speed test plugin.
 *
 * The baseline measurement — Cloudflare's speed test CDN serves raw
 * bytes with index-based chunk sizing to accurately measure connections
 * from slow DSL to multi-gigabit fiber.
 *
 * Uses the shared `createChunkBasedRunLoop` factory from plugin-runner.
 *
 * @module plugins/cloudflare
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import { bytesToMbps } from '../lib/utils.js';
import {
    createBuildResult, createChunkBasedRunLoop, withFetchTimeout,
    zeroSample, resolveByteCount,
} from '../lib/plugin-runner.js';

const CLOUDFLARE_URL = 'https://speed.cloudflare.com/__down';
const MIN_SAMPLE_DURATION_MS = 200;
const SLOW_SAMPLE_THRESHOLD_MS = 1000;
const KIB = 1024;
const MIB = 1024 * 1024;

/** Pre-allocated chunk size progression for Cloudflare's index-based sizing */
const CHUNK_256K = 256 * KIB;
const CHUNK_512K = 512 * KIB;
const CHUNK_25M = 25 * MIB;
const CHUNK_SIZES = Object.freeze([
    CHUNK_256K, CHUNK_512K, 1 * MIB, 2 * MIB, 5 * MIB, 10 * MIB, CHUNK_25M,
]);

// === Download Helper ===

/**
 * Downloads from Cloudflare's speed test endpoint and measures throughput.
 *
 * Uses `resolveByteCount` (Resource Timing API) for accurate byte counts,
 * falling back to `expectedBytes` when timing data is unavailable.
 *
 * @param {{ url: string, expectedBytes: number, timeoutMs: number }} opts
 * @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>}
 */
async function downloadAndMeasure({ url, expectedBytes, timeoutMs }) {
    return withFetchTimeout(timeoutMs, async (signal) => {
        const fetchStart = performance.now();
        const response = await fetch(url, { signal, cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        await response.blob();
        const durationMs = performance.now() - fetchStart;
        const bytes = resolveByteCount(url, expectedBytes);
        if (bytes === 0) {
            return zeroSample();
        }
        const speedMbps = bytesToMbps(bytes, durationMs);
        return { bytes, speedMbps, durationMs };
    });
}

// === Chunk Sizing Strategy ===

/**
 * Determines next chunk size index based on sample timing.
 *
 * Slower samples → decrease index (smaller chunks).
 * Faster samples → increase index (larger chunks).
 *
 * @param {number} durationMs
 * @param {number} currentIndex
 * @param {number} maxIndex
 * @returns {number}
 */
function adjustChunkIndex(durationMs, currentIndex, maxIndex) {
    if (durationMs > SLOW_SAMPLE_THRESHOLD_MS) {
        return Math.max(0, currentIndex - 1);
    }
    if (durationMs < MIN_SAMPLE_DURATION_MS) {
        return Math.min(maxIndex, currentIndex + 1);
    }
    return currentIndex;
}

// === Plugin Definition ===

const TARGET_NAME = 'Cloudflare (Baseline)';

const buildResult = createBuildResult({
    pluginId: 'cloudflare',
    targetName: TARGET_NAME,
    category: 'cdn',
});

/**
 * Builds a cache-busted Cloudflare speed test URL for the given chunk size.
 *
 * @param {number} sz - Chunk size in bytes
 * @returns {string}
 */
function buildUrl(sz) {
    return `${CLOUDFLARE_URL}?bytes=${sz}&ts=${Date.now()}`;
}

const cloudflarePlugin = {
    id: 'cloudflare',
    name: TARGET_NAME,
    description: 'Download speed from Cloudflare speed test endpoint',
    category: 'cdn',
    run: createChunkBasedRunLoop({
        buildResult,
        sizes: CHUNK_SIZES,
        buildUrl,
        nextChunk: adjustChunkIndex,
        downloadFn: downloadAndMeasure,
    }),
};

registerPlugin(cloudflarePlugin);
export { cloudflarePlugin, CHUNK_SIZES, adjustChunkIndex };
