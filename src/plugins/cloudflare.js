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
 * @param {string} url
 * @param {number} expectedBytes
 * @param {number} timeoutMs
 * @returns {Promise<{bytes: number, speedMbps: number, durationMs: number}>}
 */
async function downloadAndMeasure(url, expectedBytes, timeoutMs) {
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
        return samples.reduce((t, v) => t + v, 0) / samples.length;
    }
    const sorted = [...samples].sort((f, s) => f - s);
    const tc = Math.max(1, Math.floor(samples.length * OUTLIER_TRIM_RATIO));
    const trimmed = sorted.slice(tc, sorted.length - tc);
    if (trimmed.length === 0) {
        return sorted.reduce((t, v) => t + v, 0) / sorted.length;
    }
    return trimmed.reduce((t, v) => t + v, 0) / trimmed.length;
}

const cloudflarePlugin = {
    id: 'cloudflare',
    name: 'Cloudflare (Baseline)',
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
                const sample = await downloadAndMeasure(url, sz, timeoutMs);
                totalBytes += sample.bytes;
                if (sample.speedMbps > 0
                    && performance.now() - startTime > WARMUP_DURATION_MS) {
                    samples.push(sample.speedMbps);
                }
                if (sample.durationMs > SLOW_SAMPLE_THRESHOLD_MS) {
                    chunkIndex = Math.max(0, chunkIndex - 1);
                } else if (sample.durationMs < MIN_SAMPLE_DURATION_MS) {
                    chunkIndex = Math.min(sizes.length - 1, chunkIndex + 1);
                }
            }

            const speed = finalSpeed(samples);
            return {
                targetName: 'Cloudflare (Baseline)', pluginId: 'cloudflare',
                status: speed !== null ? 'success' : 'error',
                downloadSpeedMbps: speed,
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage: speed === null ? 'Not enough valid samples collected' : null,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            return {
                targetName: 'Cloudflare (Baseline)', pluginId: 'cloudflare',
                status: 'error', downloadSpeedMbps: null,
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage: error.message || 'Unknown error',
                timestamp: new Date().toISOString(),
            };
        }
    },
};

registerPlugin(cloudflarePlugin);
export { cloudflarePlugin };
