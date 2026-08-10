/**
 * Shared utility functions for the ISP Throttle Detector.
 *
 * @module lib/utils
 */

/** Bits per byte for speed calculations */
const BITS_PER_BYTE = 8;

/** Bytes in one million (for Mbps calculation) */
const BYTES_PER_MILLION = 1_000_000;

/** Megabit threshold for switching to Gbps display */
const MBPS_PER_GBPS = 1000;

/** Seconds per minute */
const SECONDS_PER_MINUTE = 60;

/** Milliseconds per second */
const MS_PER_SECOND = 1000;

/**
 * Formats a speed in Mbps to a human-readable string.
 *
 * @param {number|null} speed - Speed in Mbps
 * @returns {string} Formatted speed (e.g., "87.5 Mbps" or "\u2014")
 */
export function formatMbps(speed) {
    if (speed === null || speed === undefined) {
        return '\u2014';
    }
    if (speed < 0) {
        return '0.0 Mbps';
    }
    if (speed >= MBPS_PER_GBPS) {
        return `${(speed / MBPS_PER_GBPS).toFixed(2)} Gbps`;
    }
    return `${speed.toFixed(1)} Mbps`;
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "8.4s" or "1m 23s")
 */
export function formatDuration(ms) {
    if (ms < 0) {
        return '0s';
    }
    const seconds = ms / MS_PER_SECOND;
    if (seconds < 1) {
        return `${Math.round(ms)}ms`;
    }
    if (seconds < SECONDS_PER_MINUTE) {
        return `${seconds.toFixed(1)}s`;
    }
    const mins = Math.floor(seconds / SECONDS_PER_MINUTE);
    const secs = Math.round(seconds % SECONDS_PER_MINUTE);
    if (secs === 0) {
        return `${mins}m`;
    }
    return `${mins}m ${secs}s`;
}

/**
 * Formats an ISO 8601 timestamp into a human-readable date/time string.
 *
 * @param {string} iso - ISO 8601 timestamp
 * @returns {string} Formatted date/time
 */
export function formatTimestamp(iso) {
    if (!iso) {
        return '';
    }
    const date = new Date(iso);
    if (isNaN(date.getTime())) {
        return iso;
    }
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Clamps a value between min and max.
 *
 * @param {{ value: number, min: number, max: number }} options
 * @returns {number} Clamped value
 */
export function clamp({ value, min, max }) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Calculates the median of an array of numbers.
 *
 * @param {number[]} values - Array of numeric values
 * @returns {number|null} Median value, or null if array is empty
 */
export function median(values) {
    if (!values || values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

/**
 * Calculates the average (mean) of an array of numbers.
 *
 * @param {number[]} values - Array of numeric values
 * @returns {number|null} Average value, or null if array is empty
 */
export function average(values) {
    if (!values || values.length === 0) {
        return null;
    }
    const sum = values.reduce((x, y) => x + y, 0);
    return sum / values.length;
}

/**
 * Generates a unique run ID based on current timestamp with a counter
 * to prevent collisions when multiple runs start in the same second.
 *
 * Format: "run-YYYYMMDDTHHmmss-NZ"
 *
 * @returns {string} Unique run ID
 */
let idCounter = 0;
export function generateRunId() {
    const now = new Date();
    const parts = [
        now.getUTCFullYear(),
        String(now.getUTCMonth() + 1).padStart(2, '0'),
        String(now.getUTCDate()).padStart(2, '0'),
        'T',
        String(now.getUTCHours()).padStart(2, '0'),
        String(now.getUTCMinutes()).padStart(2, '0'),
        String(now.getUTCSeconds()).padStart(2, '0'),
    ];
    idCounter += 1;
    return `run-${parts.join('')}-${idCounter}Z`;
}

/**
 * Default trim ratio for trimmed mean (10% from each tail).
 *
 * @type {number}
 */
const DEFAULT_TRIM_RATIO = 0.1;

/**
 * Minimum number of samples for trimmed mean trimming.
 * Below this count, a simple average is used.
 *
 * @type {number}
 */
const DEFAULT_MIN_SAMPLES = 3;

/**
 * Computes the trimmed mean of an array of values.
 *
 * Sorts the array, trims a configurable ratio from each end, and averages
 * the remaining values. Falls back to simple average if fewer than
 * minSamples are provided. Returns null for empty/null input.
 *
 * @param {number[]|null|undefined} samples - Array of numeric values
 * @param {{trimRatio?: number, minSamples?: number}} [opts]
 * @returns {number|null} Trimmed mean, or null if no valid samples
 */
export function trimmedMean(samples, opts) {
    const { trimRatio = DEFAULT_TRIM_RATIO, minSamples = DEFAULT_MIN_SAMPLES } = opts || {};
    if (!samples || samples.length === 0) {
        return null;
    }
    if (samples.length < minSamples) {
        return samples.reduce((total, value) => total + value, 0)
            / samples.length;
    }
    const sorted = [...samples].sort((first, second) => first - second);
    const trimCount = Math.max(1, Math.floor(sorted.length * trimRatio));
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    if (trimmed.length === 0) {
        return sorted.reduce((total, value) => total + value, 0)
            / sorted.length;
    }
    return trimmed.reduce((total, value) => total + value, 0)
        / trimmed.length;
}

/**
 * Converts bytes-per-second to Mbps.
 *
 * @param {number} bytes - Bytes transferred
 * @param {number} durationMs - Duration in milliseconds
 * @returns {number} Speed in Mbps
 */
export function bytesToMbps(bytes, durationMs) {
    if (durationMs <= 0 || bytes <= 0) {
        return 0;
    }
    const bytesPerSecond = bytes / (durationMs / MS_PER_SECOND);
    return (bytesPerSecond * BITS_PER_BYTE) / BYTES_PER_MILLION;
}
