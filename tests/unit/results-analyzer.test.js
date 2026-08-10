import { describe, it, expect } from 'vitest';
import { analyzeResults } from '../../src/lib/results-analyzer.js';

/**
 * Creates a successful test result.
 *
 * @param {object} opts
 * @returns {import('../../src/lib/types.js').TestResult}
 */
function successResult(opts) {
    return {
        targetName: opts.name || opts.pluginId,
        pluginId: opts.pluginId,
        status: 'success',
        downloadSpeedMbps: opts.speedMbps,
        durationMs: 5000,
        bytesTransferred: 10 * 1024 * 1024,
        errorMessage: null,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Creates an error test result.
 *
 * @param {object} opts
 * @returns {import('../../src/lib/types.js').TestResult}
 */
function errorResult(opts) {
    return {
        targetName: opts.name || opts.pluginId,
        pluginId: opts.pluginId,
        status: 'error',
        downloadSpeedMbps: null,
        durationMs: 100,
        bytesTransferred: 0,
        errorMessage: opts.errorMessage || 'Test error',
        timestamp: new Date().toISOString(),
    };
}

describe('Results Analyzer', () => {
    describe('analyzeResults', () => {
        it('returns no_data for empty results', () => {
            const analysis = analyzeResults([]);
            expect(analysis.verdict.level).toBe('no_data');
            expect(analysis.baseline).toBeNull();
            expect(analysis.discrepancies).toHaveLength(0);
        });

        it('returns inconclusive when all tests fail', () => {
            const results = [
                errorResult({ pluginId: 'test-1', errorMessage: 'Failure 1' }),
                errorResult({ pluginId: 'test-2', errorMessage: 'Failure 2' }),
            ];
            const analysis = analyzeResults(results);
            expect(analysis.verdict.level).toBe('inconclusive');
            expect(analysis.baseline).toBeNull();
        });

        it('selects Cloudflare as baseline when available', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', speedMbps: 200 }),
                successResult({ pluginId: 'fast-com', speedMbps: 100 }),
            ];
            const analysis = analyzeResults(results);
            expect(analysis.baseline.pluginId).toBe('cloudflare');
        });

        it('selects fastest as baseline when no Cloudflare', () => {
            const results = [
                successResult({ pluginId: 'test-1', speedMbps: 50 }),
                successResult({ pluginId: 'test-2', speedMbps: 100 }),
            ];
            const analysis = analyzeResults(results);
            expect(analysis.baseline.pluginId).toBe('test-2');
        });

        it('detects normal result (within 15%)', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', speedMbps: 100 }),
                successResult({ pluginId: 'fast-com', speedMbps: 90 }),
            ];
            const analysis = analyzeResults(results);
            const disc = analysis.discrepancies.find(
                (dsc) => dsc.pluginId === 'fast-com'
            );
            expect(disc.classification).toBe('normal');
            expect(disc.isSignificant).toBe(false);
            expect(analysis.verdict.level).toBe('no_throttling');
        });

        it('detects possible throttling (15-30% slower)', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', speedMbps: 100 }),
                successResult({ pluginId: 'fast-com', speedMbps: 75 }),
            ];
            const analysis = analyzeResults(results);
            const disc = analysis.discrepancies.find(
                (dsc) => dsc.pluginId === 'fast-com'
            );
            expect(disc.classification).toBe('possible_throttling');
            expect(disc.isSignificant).toBe(true);
            expect(analysis.verdict.level).toBe('possible_throttling');
        });

        it('detects strong throttling signal (>30% slower)', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', speedMbps: 100 }),
                successResult({ pluginId: 'fast-com', speedMbps: 60 }),
            ];
            const analysis = analyzeResults(results);
            const disc = analysis.discrepancies.find(
                (dsc) => dsc.pluginId === 'fast-com'
            );
            expect(disc.classification).toBe('strong_signal');
            expect(disc.isSignificant).toBe(true);
            expect(analysis.verdict.level).toBe('strong_signal');
        });

        it('classifies faster-than-baseline as inconclusive', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', speedMbps: 100 }),
                successResult({ pluginId: 'fast-com', speedMbps: 130 }),
            ];
            const analysis = analyzeResults(results);
            const disc = analysis.discrepancies.find(
                (dsc) => dsc.pluginId === 'fast-com'
            );
            expect(disc.classification).toBe('inconclusive');
        });

        it('correctly calculates percentage deviation', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', speedMbps: 100 }),
                successResult({ pluginId: 'fast-com', speedMbps: 85 }),
            ];
            const analysis = analyzeResults(results);
            const disc = analysis.discrepancies.find(
                (dsc) => dsc.pluginId === 'fast-com'
            );
            expect(disc.percentageDeviation).toBe(-15);
        });

        it('handles mixed success and error results', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', speedMbps: 200 }),
                successResult({ pluginId: 'fast-com', speedMbps: 100 }),
                errorResult({ pluginId: 'test-err', errorMessage: 'Failed' }),
            ];
            const analysis = analyzeResults(results);
            expect(analysis.verdict.level).toBe('strong_signal');
            const errDisc = analysis.discrepancies.find(
                (dsc) => dsc.pluginId === 'test-err'
            );
            expect(errDisc.classification).toBe('inconclusive');
        });

        it('returns correct verdict message for no_throttling', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', speedMbps: 100 }),
                successResult({ pluginId: 'fast-com', speedMbps: 95 }),
            ];
            const analysis = analyzeResults(results);
            expect(analysis.verdict.message).toBe('No throttling detected');
            expect(analysis.verdict.indicator).toBe('green');
        });

        it('returns correct verdict message for strong_signal', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', name: 'Baseline', speedMbps: 200 }),
                successResult({ pluginId: 'fast-com', name: 'Fast.com', speedMbps: 50 }),
            ];
            const analysis = analyzeResults(results);
            expect(analysis.verdict.level).toBe('strong_signal');
            expect(analysis.verdict.message).toContain('Fast.com');
            expect(analysis.verdict.indicator).toBe('red');
        });

        it('handles results where baseline is the only plugin', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', speedMbps: 100 }),
            ];
            const analysis = analyzeResults(results);
            expect(analysis.verdict.level).toBe('no_throttling');
            expect(analysis.discrepancies).toHaveLength(0);
        });

        it('raises strongest verdict when multiple signals present', () => {
            const results = [
                successResult({ pluginId: 'cloudflare', speedMbps: 200 }),
                successResult({ pluginId: 'fast-com', name: 'Netflix', speedMbps: 160 }),
                successResult({ pluginId: 'google-cdn', name: 'Google', speedMbps: 80 }),
            ];
            const analysis = analyzeResults(results);
            expect(analysis.verdict.level).toBe('strong_signal');
        });
    });
});
