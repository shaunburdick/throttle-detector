/**
 * Cloudflare baseline speed test plugin.
 *
 * @module plugins/cloudflare
 */

import { registerPlugin } from '../lib/plugin-registry.js';

const CLOUDFLARE_URL = 'https://speed.cloudflare.com/__down';
const SAMPLE_DURATION_MS = 10000;
const WARMUP_DURATION_MS = 1000;
const BYTES_PER_SECOND = 1000;
const BITS_PER_BYTE = 8;
const BYTES_PER_MILLION = 1_000_000;
const MIN_SAMPLE_DURATION_MS = 200;
const SLOW_SAMPLE_THRESHOLD_MS = 1000;
const OUTLIER_TRIM_RATIO = 0.1;
const MIN_SAMPLES = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const KIB = 1024;
const MIB = 1024 * 1024;
const SMALL_CHUNK = 256 * KIB;
const MED_CHUNK = 512 * KIB;
const LARGE_CHUNK = 25 * MIB;

// === Helpers (function declarations hoist) ===

function chunkSizes() {
    return [
        SMALL_CHUNK, MED_CHUNK, 1 * MIB, 2 * MIB, 5 * MIB, 10 * MIB, LARGE_CHUNK,
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
        const bps = bytes / (durationMs / BYTES_PER_SECOND);
        return { bytes, speedMbps: (bps * BITS_PER_BYTE) / BYTES_PER_MILLION, durationMs };
    } finally {
        clearTimeout(timeoutId);
    }
}

/** @param {number[]} samples @returns {number|null} */
function finalSpeed(samples) {
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

const TARGET_NAME = 'Cloudflare (Baseline)';

/**
 * @param {{ status: string, speedMbps: number|null, durationMs: number,
 *   bytesTransferred: number, errorMessage: string|null }} opts
 * @returns {import('../lib/types.js').TestResult}
 */
function buildResult({ status, speedMbps, durationMs, bytesTransferred,
    errorMessage }) {
    return {
        targetName: TARGET_NAME, pluginId: 'cloudflare',
        status, downloadSpeedMbps: speedMbps,
        durationMs, bytesTransferred, errorMessage,
        timestamp: new Date().toISOString(),
    };
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

const cloudflarePlugin = {
    id: 'cloudflare',
    name: TARGET_NAME,
    description: 'Download speed from Cloudflare speed test endpoint',
    category: 'cdn',

    async run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs || SAMPLE_DURATION_MS;
        const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
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
                    && performance.now() - startTime > WARMUP_DURATION_MS) {
                    samples.push(sample.speedMbps);
                }
                chunkIndex = adjustChunkIndex(
                    sample.durationMs, chunkIndex,
                    sizes.length - 1
                );
            }

            const speed = finalSpeed(samples);
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
