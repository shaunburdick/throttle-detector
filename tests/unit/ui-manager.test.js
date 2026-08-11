/**
 * UI Manager tests — DOM manipulation, state, and event handling.
 *
 * jsdom provides the DOM environment. Modules that touch browser APIs
 * are mocked as needed.
 *
 * @module tests/unit/ui-manager.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock results-presenter before importing ui-manager
vi.mock('../../src/lib/results-presenter.js', () => ({
    presentHtml: vi.fn((run) => {
        if (!run || run.results.length === 0) {
            return '<div class="empty-state"><p>No results</p></div>';
        }
        return `<div class="results-section" aria-labelledby="results-heading">`
            + `<table><caption id="results-heading">Results</caption></table>`
            + `<div class="verdict-card">Verdict: ${run.verdict?.message || ''}</div>`
            + `</div>`;
    }),
}));

import {
    init, setRunning, updateProgress, updatePluginStatus,
    setResults, renderHistory, showErrorState, markPluginRunning,
    buildErrorHtml, getState,
} from '../../src/lib/ui-manager.js';

/**
 * Creates a minimal mock TestPlugin for UI rendering.
 *
 * @param {object} opts
 * @returns {import('../../src/lib/types.js').TestPlugin}
 */
function mockPlugin(opts = {}) {
    return {
        id: opts.id || 'mock-plugin',
        name: opts.name || 'Mock Plugin',
        description: opts.description || 'A mock plugin',
        category: opts.category || 'cdn',
        run: opts.run || (async () => ({})),
    };
}

/**
 * Creates a minimal mock TestRun for setResults.
 *
 * @param {object} opts
 * @returns {import('../../src/lib/types.js').TestRun}
 */
function mockTestRun(opts = {}) {
    return {
        runId: opts.runId || 'test-run-1',
        timestamp: opts.timestamp || new Date().toISOString(),
        results: opts.results || [{
            targetName: 'Test Target',
            pluginId: 'test',
            status: 'success',
            downloadSpeedMbps: 100,
            durationMs: 5000,
            bytesTransferred: 1024000,
            errorMessage: null,
            timestamp: new Date().toISOString(),
            category: 'cdn',
        }],
        baselinePluginId: opts.baselinePluginId || 'test',
        discrepancies: opts.discrepancies || [],
        verdict: opts.verdict || {
            level: 'no_throttling',
            message: 'No throttling detected',
            affectedServices: [],
            indicator: 'green',
        },
        warnings: opts.warnings || [],
    };
}

/**
 * Creates a minimal HistoryEntry for renderHistory.
 *
 * @param {object} opts
 * @returns {import('../../src/lib/types.js').HistoryEntry}
 */
function mockHistoryEntry(opts = {}) {
    return {
        runId: opts.runId || 'hist-1',
        timestamp: opts.timestamp || '2026-08-10T12:00:00.000Z',
        pluginCount: opts.pluginCount || 4,
        successCount: opts.successCount || 4,
        errorCount: opts.errorCount || 0,
        summary: opts.summary || 'No throttling detected',
        verdict: opts.verdict || {
            level: 'no_throttling',
            message: 'No throttling detected',
            affectedServices: [],
            indicator: 'green',
        },
        results: opts.results || [{
            targetName: 'Test',
            pluginId: 'test',
            status: 'success',
            downloadSpeedMbps: 100,
            durationMs: 5000,
            bytesTransferred: 1024000,
            errorMessage: null,
            timestamp: '2026-08-10T12:00:00.000Z',
            category: 'cdn',
        }],
    };
}

// ===== Setup =====

beforeEach(() => {
    document.body.innerHTML = '<main id="main-content">'
        + '<div id="status-live" aria-live="polite"></div></main>';
    // Reset vitest timers
    vi.useFakeTimers();
});

// ===== Tests =====

describe('UI Manager', () => {
    describe('init', () => {
        it('renders initial HTML with Run Test button', () => {
            init({ onRunTest: () => {} });
            const btn = document.getElementById('run-test-btn');
            expect(btn).toBeDefined();
            expect(btn.textContent).toBe('Run Test');
            expect(getState()).toBe('initial');
        });

        it('shows warning banners when warnings are provided', () => {
            init({ onRunTest: () => {},
                warnings: ['Storage nearly full'] });
            const banners = document.querySelectorAll('.warning-banner');
            expect(banners.length).toBe(1);
            expect(banners[0].textContent).toContain('Storage nearly full');
        });

        it('sets up the aria-live status region', () => {
            init({ onRunTest: () => {} });
            const live = document.getElementById('status-live');
            expect(live).toBeDefined();
            expect(live.getAttribute('aria-live')).toBe('polite');
        });
    });

    describe('setRunning', () => {
        it('renders plugin list with all rows in queued state', () => {
            init({ onRunTest: () => {} });
            const plugins = [
                mockPlugin({ id: 'a', name: 'Alpha' }),
                mockPlugin({ id: 'b', name: 'Beta' }),
            ];
            setRunning(plugins);

            const items = document.querySelectorAll('.test-status-item');
            expect(items.length).toBe(2);
            expect(items[0].classList.contains('test-status-item--queued')).toBe(true);
            expect(items[0].textContent).toContain('Alpha');
            expect(items[1].classList.contains('test-status-item--queued')).toBe(true);
            expect(items[1].textContent).toContain('Beta');
        });

        it('renders progress bar with correct aria attributes', () => {
            init({ onRunTest: () => {} });
            setRunning([mockPlugin()]);
            const bar = document.querySelector('.progress-bar');
            expect(bar.getAttribute('aria-valuenow')).toBe('0');
            expect(bar.getAttribute('aria-valuemin')).toBe('0');
            expect(bar.getAttribute('aria-valuemax')).toBe('1');
        });

        it('disables the Run Test button', () => {
            init({ onRunTest: () => {} });
            setRunning([mockPlugin()]);
            const btn = document.getElementById('run-test-btn');
            expect(btn.disabled).toBe(true);
            expect(btn.textContent).toBe('Testing...');
        });

        it('shows progress text with plugin count', () => {
            init({ onRunTest: () => {} });
            setRunning([mockPlugin(), mockPlugin({ id: 'b' })]);

            const txt = document.querySelector('.progress-text');
            expect(txt.textContent).toContain('2 tests complete');
        });

        it('shows category badges on each plugin row', () => {
            init({ onRunTest: () => {} });
            setRunning([
                mockPlugin({ id: 'a', category: 'cdn' }),
                mockPlugin({ id: 'b', category: 'streaming' }),
            ]);
            const badges = document.querySelectorAll('.test-status-item .badge');
            expect(badges.length).toBe(2);
            expect(badges[0].textContent).toBe('cdn');
            expect(badges[1].textContent).toBe('streaming');
        });
    });

    describe('markPluginRunning', () => {
        it('transitions a row from queued to running state', () => {
            init({ onRunTest: () => {} });
            setRunning([mockPlugin({ id: 'x', name: 'Service X' })]);
            markPluginRunning('x');

            const item = document.querySelector('[data-plugin-id="x"]');
            expect(item.classList.contains('test-status-item--running')).toBe(true);
            expect(item.classList.contains('test-status-item--queued')).toBe(false);
            const label = item.querySelector('.test-status-label');
            expect(label.textContent).toBe('Running...');
        });

        it('is a no-op for unknown plugin id', () => {
            init({ onRunTest: () => {} });
            setRunning([mockPlugin({ id: 'known' })]);
            expect(() => markPluginRunning('unknown')).not.toThrow();
        });
    });

    describe('updateProgress', () => {
        it('updates progress bar percentage and aria', () => {
            init({ onRunTest: () => {} });
            setRunning([
                mockPlugin({ id: 'a' }),
                mockPlugin({ id: 'b' }),
                mockPlugin({ id: 'c' }),
                mockPlugin({ id: 'd' }),
            ]);

            updateProgress(2, 4);

            const bar = document.querySelector('.progress-bar');
            expect(bar.getAttribute('aria-valuenow')).toBe('2');
            const fill = document.querySelector('.progress-bar-fill');
            expect(fill.style.width).toBe('50%');
            const txt = document.querySelector('.progress-text');
            expect(txt.textContent).toContain('2 of 4');
        });

        it('updates progress text after completion', () => {
            init({ onRunTest: () => {} });
            setRunning([mockPlugin(), mockPlugin({ id: 'b' })]);
            updateProgress(2, 2);

            const txt = document.querySelector('.progress-text');
            expect(txt.textContent).toBe('2 of 2 tests complete');
            const bar = document.querySelector('.progress-bar');
            expect(bar.getAttribute('aria-valuenow')).toBe('2');
            const fill = document.querySelector('.progress-bar-fill');
            expect(fill.style.width).toBe('100%');
        });

        it('handles zero total gracefully', () => {
            init({ onRunTest: () => {} });
            setRunning([]);
            expect(() => updateProgress(0, 0)).not.toThrow();
            const fill = document.querySelector('.progress-bar-fill');
            expect(fill.style.width).toBe('0%');
        });
    });

    describe('updatePluginStatus', () => {
        it('marks a row as complete with checkmark', () => {
            init({ onRunTest: () => {} });
            setRunning([mockPlugin({ id: 'ok', name: 'Complete Test' })]);
            updatePluginStatus('ok', true);

            const item = document.querySelector('[data-plugin-id="ok"]');
            expect(item.classList.contains('test-status-item--queued')).toBe(false);
            const icon = item.querySelector('.test-status-icon--complete');
            expect(icon).toBeDefined();
            const label = item.querySelector('.test-status-label');
            expect(label.textContent).toBe('Complete');
        });

        it('marks a row as error with X mark', () => {
            init({ onRunTest: () => {} });
            setRunning([mockPlugin({ id: 'fail', name: 'Error Test' })]);
            updatePluginStatus('fail', false);

            const item = document.querySelector('[data-plugin-id="fail"]');
            const icon = item.querySelector('.test-status-icon--error');
            expect(icon).toBeDefined();
            const label = item.querySelector('.test-status-label');
            expect(label.textContent).toBe('Error');
        });

        it('is a no-op for unknown plugin id', () => {
            init({ onRunTest: () => {} });
            setRunning([mockPlugin({ id: 'known' })]);
            expect(() => updatePluginStatus('unknown', true)).not.toThrow();
        });
    });

    describe('setResults', () => {
        it('renders results HTML via presentHtml', () => {
            init({ onRunTest: () => {} });
            const run = mockTestRun();
            setResults(run);

            const area = document.getElementById('results-area');
            expect(area.innerHTML).toContain('Results');
            expect(area.innerHTML).toContain('No throttling detected');
        });

        it('re-enables the Run Test button', () => {
            init({ onRunTest: () => {} });
            setRunning([mockPlugin()]);
            setResults(mockTestRun());

            const btn = document.getElementById('run-test-btn');
            expect(btn.disabled).toBe(false);
            expect(btn.textContent).toBe('Run Test');
        });

        it('sets state to error-full when all results failed', () => {
            init({ onRunTest: () => {} });
            const run = mockTestRun({
                results: [{
                    targetName: 'Fail',
                    pluginId: 'fail',
                    status: 'error',
                    downloadSpeedMbps: null,
                    durationMs: 100,
                    bytesTransferred: 0,
                    errorMessage: 'CORS error',
                    timestamp: new Date().toISOString(),
                    category: 'cdn',
                }],
            });
            setResults(run);
            expect(getState()).toBe('error-full');
        });

        it('sets state to complete when at least one result succeeded', () => {
            init({ onRunTest: () => {} });
            setResults(mockTestRun());
            expect(getState()).toBe('complete');
        });
    });

    describe('renderHistory', () => {
        it('renders empty state when no entries', () => {
            init({ onRunTest: () => {} });
            renderHistory([]);

            const area = document.getElementById('history-area');
            expect(area.innerHTML).toContain('No tests run yet');
        });

        it('renders history entries with summaries and timestamps', () => {
            init({ onRunTest: () => {} });
            const entries = [mockHistoryEntry()];
            renderHistory(entries);

            const area = document.getElementById('history-area');
            expect(area.innerHTML).toContain('No throttling detected');
            expect(area.innerHTML).toContain('Test History');
        });

        it('renders multiple history entries', () => {
            init({ onRunTest: () => {} });
            renderHistory([
                mockHistoryEntry({ runId: 'a', summary: 'First' }),
                mockHistoryEntry({ runId: 'b', summary: 'Second' }),
            ]);

            const entries = document.querySelectorAll('.history-list-item');
            expect(entries.length).toBe(2);
        });

        it('wires history click callback', () => {
            const clicks = [];
            init({
                onRunTest: () => {},
                onHistoryClick: (id) => clicks.push(id),
            });
            renderHistory([mockHistoryEntry({ runId: 'click-me' })]);

            const entry = document.querySelector('.history-entry');
            entry.click();
            expect(clicks).toEqual(['click-me']);
        });

        it('renders delete-all button', () => {
            init({ onRunTest: () => {}, onHistoryDeleteAll: () => {} });
            renderHistory([mockHistoryEntry()]);

            const deleteAll = document.querySelector('.btn-delete-all');
            expect(deleteAll).toBeDefined();
            expect(deleteAll.textContent).toContain('Delete All');
        });
    });

    describe('showErrorState', () => {
        it('renders error state with reasons', () => {
            init({ onRunTest: () => {} });
            showErrorState(['Network error', 'CORS blocked']);

            const area = document.getElementById('results-area');
            expect(area.innerHTML).toContain('Unable to Determine');
            expect(area.innerHTML).toContain('Network error');
            expect(area.innerHTML).toContain('CORS blocked');
        });

        it('sets state to error-full', () => {
            init({ onRunTest: () => {} });
            showErrorState(['Error']);
            expect(getState()).toBe('error-full');
        });
    });

    describe('buildErrorHtml', () => {
        it('generates error HTML with icon, title, and message', () => {
            const html = buildErrorHtml({
                icon: '\u274C',
                title: 'Something Went Wrong',
                message: 'Please try again.',
            });
            expect(html).toContain('Something Went Wrong');
            expect(html).toContain('Please try again.');
            expect(html).toContain('role="alert"');
        });

        it('includes list items when provided', () => {
            const html = buildErrorHtml({
                icon: '\u26A0',
                title: 'Warnings',
                message: 'Issues found.',
                items: ['Issue 1', 'Issue 2'],
            });
            expect(html).toContain('<li>Issue 1</li>');
            expect(html).toContain('<li>Issue 2</li>');
        });

        it('escapes HTML in title and message', () => {
            const html = buildErrorHtml({
                icon: 'X',
                title: '<script>alert(1)</script>',
                message: '<b>bold</b>',
            });
            expect(html).not.toContain('<script>');
            expect(html).not.toContain('<b>');
            expect(html).toContain('&lt;script&gt;');
            expect(html).toContain('&lt;b&gt;');
        });
    });

    describe('showInlineConfirm', () => {
        /**
         * Triggers the inline confirm by clicking a delete button.
         * Relies on renderHistory wiring delete callbacks.
         *
         * @param {object} opts
         * @returns {{ wrapper: HTMLElement, yesBtn: HTMLElement, cancelBtn: HTMLElement }}
         */
        function triggerInlineConfirm(opts = {}) {
            const deleted = [];
            init({
                onRunTest: () => {},
                onHistoryDelete: opts.onDelete || ((id) => deleted.push(id)),
            });
            renderHistory([mockHistoryEntry({ runId: 'del-1' })]);

            const deleteBtn = document.querySelector('.btn-delete-history');
            deleteBtn.click();
            vi.runAllTimers();

            const wrapper = document.querySelector('.inline-confirm');
            return {
                wrapper,
                yesBtn: wrapper.querySelector('.btn-confirm-yes'),
                cancelBtn: wrapper.querySelector('.btn-confirm-cancel'),
                deleted,
            };
        }

        it('shows confirm dialog when delete button is clicked', () => {
            const { wrapper } = triggerInlineConfirm();
            expect(wrapper).toBeDefined();
            expect(wrapper.textContent).toContain('Yes');
            expect(wrapper.textContent).toContain('Cancel');
        });

        it('calls onConfirm when Yes is clicked', () => {
            const deleted = [];
            const { yesBtn } = triggerInlineConfirm({
                onDelete: (id) => deleted.push(id),
            });
            yesBtn.click();
            expect(deleted).toEqual(['del-1']);
        });

        it('restores original element when Cancel is clicked', () => {
            const { cancelBtn } = triggerInlineConfirm();
            cancelBtn.click();

            // The original delete button should be back in the DOM
            const deleteBtns = document.querySelectorAll('.btn-delete-history');
            expect(deleteBtns.length).toBe(1);
        });

        it('restores on Escape key', () => {
            const { wrapper } = triggerInlineConfirm();
            const event = new KeyboardEvent('keydown', {
                key: 'Escape', bubbles: true,
            });
            wrapper.dispatchEvent(event);

            const deleteBtns = document.querySelectorAll('.btn-delete-history');
            expect(deleteBtns.length).toBe(1);
        });

        it('traps Tab focus between Yes and Cancel buttons', () => {
            const { wrapper, yesBtn, cancelBtn } = triggerInlineConfirm();

            // Initial focus is on Cancel
            expect(document.activeElement).toBe(cancelBtn);

            // Tab forward → Yes
            const tabEvent = new KeyboardEvent('keydown', {
                key: 'Tab', bubbles: true,
            });
            wrapper.dispatchEvent(tabEvent);
            expect(document.activeElement).toBe(yesBtn);

            // Tab forward again → wraps to Cancel
            wrapper.dispatchEvent(tabEvent);
            expect(document.activeElement).toBe(cancelBtn);
        });

        it('traps Shift+Tab focus between buttons', () => {
            const { wrapper, yesBtn, cancelBtn } = triggerInlineConfirm();

            // Initial focus on Cancel
            expect(document.activeElement).toBe(cancelBtn);

            // Shift+Tab backward → wraps to Yes
            const shiftTabEvent = new KeyboardEvent('keydown', {
                key: 'Tab', shiftKey: true, bubbles: true,
            });
            wrapper.dispatchEvent(shiftTabEvent);
            expect(document.activeElement).toBe(yesBtn);

            // Shift+Tab again → wraps to Cancel
            wrapper.dispatchEvent(shiftTabEvent);
            expect(document.activeElement).toBe(cancelBtn);
        });

        it('focuses Cancel button when dialog appears', () => {
            const { cancelBtn } = triggerInlineConfirm();
            expect(document.activeElement).toBe(cancelBtn);
        });
    });
});
