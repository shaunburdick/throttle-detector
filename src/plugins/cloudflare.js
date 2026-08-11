/**
 * Cloudflare baseline speed test plugin.
 *
 * The baseline measurement — Cloudflare's speed test CDN serves raw
 * bytes with adaptive chunk sizing to accurately measure connections
 * from slow DSL to multi-gigabit fiber.
 *
 * @module plugins/cloudflare
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import { bytesToMbps, trimmedMean } from '../lib/utils.js';
import {
    createBuildResult, DEFAULT_SAMPLE_DURATION, DEFAULT_WARMUP_DURATION,
    DEFAULT_TIMEOUT,
} from '../lib/plugin-runner.js';

const CLOUDFLARE_URL = 'https://speed.cloudflare.com/__down';
const MIN_SAMPLE_DURATION_MS = 200;
const SLOW_SAMPLE_THRESHOLD_MS = 1000;
const KIB = 1024;
const MIB = 1024 * 1024;
const SMALL_CHUNK = 256 * KIB;
const MED_CHUNK = 512 * KIB;
const LARGE_CHUNK = 25 * MIB;

// === Helpers (function declarations hoist) ===

function chunkSizes() {
    return [
        SMALL_CHUNK, MED_CHUNK, 1 * MIB, 2 * MIB, 5 * MIB, 10 * MIB,
        LARGE_CHUNK,
    ];
}

/**
 * @param {{ url: string, expectedBytes: number, timeoutMs: number }} opts
 * @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>}
 */
async function downloadAndMeasure({ url, expectedBytes, timeoutMs }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const fetchStart = performance.now();
        const response = await fetch(url, {
            signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        await response.blob();
        const durationMs = performance.now() - fetchStart;
        let bytes = expectedBytes;
        const entries = performance.getEntriesByName(url);
        if (entries.length > 0) {
            const entry = entries[entries.length - 1];
            if (entry.transferSize > 0) {
                bytes = entry.transferSize;
            } else if (entry.encodedBodySize > 0) {
                bytes = entry.encodedBodySize;
            }
        }
        const speedMbps = bytesToMbps(bytes, durationMs);
        return { bytes, speedMbps, durationMs };
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Determines next chunk size based on sample timing.
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

const TARGET_NAME = 'Cloudflare (Baseline)';

const buildResult = createBuildResult({
    pluginId: 'cloudflare',
    targetName: TARGET_NAME,
    category: 'cdn',
});

const cloudflarePlugin = {
    id: 'cloudflare',
    name: TARGET_NAME,
    description: 'Download speed from Cloudflare speed test endpoint',
    category: 'cdn',

    async run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs
            || DEFAULT_SAMPLE_DURATION;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT;
        let totalBytes = 0;
        const samples = [];

        try {
            const sizes = chunkSizes();
            let chunkIndex = 0;

            while (performance.now() - startTime < sampleDuration) {
                if (performance.now() - startTime > timeoutMs) {
                    break;
                }
                const sz = sizes[Math.min(chunkIndex, sizes.length - 1)];
                const url = `${CLOUDFLARE_URL}?bytes=${sz}&ts=${Date.now()}`;
                const sample = await downloadAndMeasure({
                    url, expectedBytes: sz, timeoutMs,
                });
                totalBytes += sample.bytes;
                if (sample.speedMbps > 0
                    && performance.now() - startTime
                        > DEFAULT_WARMUP_DURATION) {
                    samples.push(sample.speedMbps);
                }
                chunkIndex = adjustChunkIndex(
                    sample.durationMs, chunkIndex,
                    sizes.length - 1
                );
            }

            const speed = trimmedMean(samples);
            const errorMessage = speed === null
                ? 'Not enough valid samples collected' : null;
            return buildResult({
                status: speed !== null ? 'success' : 'error',
                speedMbps: speed,
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage,
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

registerPlugin(cloudflarePlugin);
export { cloudflarePlugin };
