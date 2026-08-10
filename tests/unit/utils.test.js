import { describe, it, expect } from 'vitest';
import {
    formatMbps,
    formatDuration,
    formatTimestamp,
    clamp,
    median,
    average,
    generateRunId,
    bytesToMbps,
} from '../../src/lib/utils.js';

describe('formatMbps', () => {
    it('returns "\u2014" for null or undefined', () => {
        expect(formatMbps(null)).toBe('\u2014');
        expect(formatMbps()).toBe('\u2014');
    });

    it('returns "0.0 Mbps" for zero', () => {
        expect(formatMbps(0)).toBe('0.0 Mbps');
    });

    it('returns "0.0 Mbps" for negative values', () => {
        expect(formatMbps(-5)).toBe('0.0 Mbps');
    });

    it('formats sub-1000 Mbps values with one decimal', () => {
        expect(formatMbps(87.5)).toBe('87.5 Mbps');
        expect(formatMbps(1)).toBe('1.0 Mbps');
        expect(formatMbps(999.9)).toBe('999.9 Mbps');
    });

    it('formats Gbps for values >= 1000 Mbps', () => {
        expect(formatMbps(1000)).toBe('1.00 Gbps');
        expect(formatMbps(10000)).toBe('10.00 Gbps');
        expect(formatMbps(1234.5)).toBe('1.23 Gbps');
    });
});

describe('formatDuration', () => {
    it('returns "0s" for negative values', () => {
        expect(formatDuration(-1)).toBe('0s');
    });

    it('formats milliseconds for durations < 1 second', () => {
        expect(formatDuration(0)).toBe('0ms');
        expect(formatDuration(500)).toBe('500ms');
        expect(formatDuration(999)).toBe('999ms');
    });

    it('formats seconds with one decimal for durations < 60 seconds', () => {
        expect(formatDuration(1000)).toBe('1.0s');
        expect(formatDuration(8423)).toBe('8.4s');
        expect(formatDuration(59500)).toBe('59.5s');
    });

    it('formats minutes and seconds for durations >= 60 seconds', () => {
        expect(formatDuration(60000)).toBe('1m');
        expect(formatDuration(90000)).toBe('1m 30s');
        expect(formatDuration(125000)).toBe('2m 5s');
        expect(formatDuration(180000)).toBe('3m');
    });
});

describe('formatTimestamp', () => {
    it('returns empty string for falsy input', () => {
        expect(formatTimestamp('')).toBe('');
        expect(formatTimestamp(null)).toBe('');
    });

    it('returns raw string for invalid date', () => {
        expect(formatTimestamp('not-a-date')).toBe('not-a-date');
    });

    it('formats a valid ISO 8601 timestamp', () => {
        const iso = '2026-08-10T14:30:00.000Z';
        const result = formatTimestamp(iso);
        expect(result).toBeTruthy();
        expect(result.length).toBeGreaterThan(5);
    });
});

describe('clamp', () => {
    it('returns value when within range', () => {
        expect(clamp({ value: 5, min: 0, max: 10 })).toBe(5);
        expect(clamp({ value: 0, min: 0, max: 10 })).toBe(0);
        expect(clamp({ value: 10, min: 0, max: 10 })).toBe(10);
    });

    it('returns min when value is below range', () => {
        expect(clamp({ value: -5, min: 0, max: 10 })).toBe(0);
    });

    it('returns max when value is above range', () => {
        expect(clamp({ value: 15, min: 0, max: 10 })).toBe(10);
    });
});

describe('median', () => {
    it('returns null for empty array', () => {
        expect(median([])).toBeNull();
    });

    it('returns null for null/undefined input', () => {
        expect(median(null)).toBeNull();
        expect(median()).toBeNull();
    });

    it('returns the single value for one-element array', () => {
        expect(median([5])).toBe(5);
    });

    it('returns middle value for odd-length array', () => {
        expect(median([1, 3, 2])).toBe(2);
    });

    it('returns average of middle two for even-length array', () => {
        expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it('does not mutate input array', () => {
        const input = [3, 1, 2];
        median(input);
        expect(input).toEqual([3, 1, 2]);
    });
});

describe('average', () => {
    it('returns null for empty array', () => {
        expect(average([])).toBeNull();
    });

    it('returns null for null/undefined', () => {
        expect(average(null)).toBeNull();
        expect(average()).toBeNull();
    });

    it('calculates average correctly', () => {
        expect(average([2, 4, 6])).toBe(4);
        expect(average([1])).toBe(1);
    });

    it('handles negative values', () => {
        expect(average([-2, 2])).toBe(0);
    });
});

describe('generateRunId', () => {
    it('returns a string starting with "run-"', () => {
        const id = generateRunId();
        expect(id.startsWith('run-')).toBe(true);
    });

    it('returns a string matching the expected format', () => {
        const id = generateRunId();
        expect(id.startsWith('run-')).toBe(true);
        // Format: run-YYYYMMDDTHHmmssZ (second-based, minimum 17 chars)
        expect(id.length).toBeGreaterThanOrEqual(20);
        expect(id.endsWith('Z')).toBe(true);
    });
});

describe('bytesToMbps', () => {
    it('returns 0 for zero duration', () => {
        expect(bytesToMbps(1000, 0)).toBe(0);
    });

    it('returns 0 for zero bytes', () => {
        expect(bytesToMbps(0, 1000)).toBe(0);
    });

    it('calculates Mbps correctly', () => {
        // 1 MB (8,000,000 bits) in 1000ms = 8 Mbps
        const result = bytesToMbps(1_000_000, 1000);
        expect(result).toBe(8);
    });

    it('calculates large transfers correctly', () => {
        // 50 MB in 5000ms = 80 Mbps
        const bytes = 50 * 1024 * 1024;
        const ms = 5000;
        const result = bytesToMbps(bytes, ms);
        expect(result).toBeCloseTo(83.89, 0);
    });
});
