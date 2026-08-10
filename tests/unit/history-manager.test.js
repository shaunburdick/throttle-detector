import { describe, it, expect, beforeEach } from 'vitest';
import { save, loadAll, getByRunId, clear, isAvailable } from '../../src/lib/history-manager.js';
import { generateRunId } from '../../src/lib/utils.js';

/**
 * Creates a minimal mock TestRun for testing.
 *
 * @param {object} opts
 * @returns {import('../../src/lib/types.js').TestRun}
 */
function createMockRun(opts = {}) {
    return {
        runId: opts.runId || generateRunId(),
        timestamp: opts.timestamp || new Date().toISOString(),
        results: opts.results || [
            {
                targetName: 'Mock',
                pluginId: 'mock',
                status: 'success',
                downloadSpeedMbps: 100,
                durationMs: 5000,
                bytesTransferred: 1024,
                errorMessage: null,
                timestamp: new Date().toISOString(),
            },
        ],
        baselinePluginId: 'mock',
        discrepancies: [],
        verdict: opts.verdict || {
            level: 'no_throttling',
            message: 'No throttling detected',
            affectedServices: [],
            indicator: 'green',
        },
        warnings: opts.warnings || [],
    };
}

describe('History Manager', () => {
    beforeEach(() => {
        clear();
    });

    describe('save', () => {
        it('saves a test run and returns true', () => {
            const run = createMockRun();
            const result = save(run);
            expect(result).toBe(true);
        });

        it('stores entries with newest first', () => {
            const run1 = createMockRun({ runId: 'run-old' });
            const run2 = createMockRun({ runId: 'run-new' });
            save(run1);
            save(run2);
            const entries = loadAll();
            expect(entries[0].runId).toBe('run-new');
            expect(entries[1].runId).toBe('run-old');
        });

        it('persists across loadAll calls', () => {
            const run = createMockRun();
            save(run);
            const entries = loadAll();
            expect(entries).toHaveLength(1);
            expect(entries[0].runId).toBe(run.runId);
        });

        it('enforces MAX_ENTRIES limit', () => {
            for (let i = 0; i < 55; i++) {
                const run = createMockRun({ runId: `run-${i}` });
                save(run);
            }
            const entries = loadAll();
            expect(entries.length).toBeLessThanOrEqual(50);
            // Most recent should be first
            expect(entries[0].runId).toBe('run-54');
        });

        it('includes correct summary in entry', () => {
            const run = createMockRun({
                verdict: {
                    level: 'strong_signal',
                    message: 'Strong throttling for Netflix',
                    affectedServices: ['Fast.com (Netflix)'],
                    indicator: 'red',
                },
            });
            save(run);
            const entries = loadAll();
            expect(entries[0].summary).toContain('Fast.com');
        });
    });

    describe('loadAll', () => {
        it('returns empty array when no history', () => {
            expect(loadAll()).toEqual([]);
        });

        it('returns all saved entries', () => {
            save(createMockRun({ runId: 'a' }));
            save(createMockRun({ runId: 'b' }));
            expect(loadAll()).toHaveLength(2);
        });

        it('handles corrupted data gracefully', () => {
            localStorage.setItem('throttle-detector-history', 'not-json{{');
            expect(loadAll()).toEqual([]);
        });
    });

    describe('getByRunId', () => {
        it('returns entry by runId', () => {
            const run = createMockRun({ runId: 'find-me' });
            save(run);
            const entry = getByRunId('find-me');
            expect(entry).toBeDefined();
            expect(entry.runId).toBe('find-me');
        });

        it('returns undefined for missing runId', () => {
            expect(getByRunId('nonexistent')).toBeUndefined();
        });
    });

    describe('clear', () => {
        it('removes all entries', () => {
            save(createMockRun());
            clear();
            expect(loadAll()).toEqual([]);
        });
    });

    describe('isAvailable', () => {
        it('returns true when localStorage is writable', () => {
            // jsdom supports localStorage
            expect(isAvailable()).toBe(true);
        });
    });
});
