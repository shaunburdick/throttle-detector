/**
 * ISP Throttle Detector — Application Entry Point.
 *
 * @module app
 */

import './plugins/cloudflare.js';
import './plugins/cloudfront.js';
import './plugins/youtube.js';
import './plugins/jsdelivr.js';
import './plugins/github.js';
import './plugins/bunny-cdn.js';

import { getPlugins } from './lib/plugin-registry.js';
import { runAll } from './lib/test-runner.js';
import { analyzeResults } from './lib/results-analyzer.js';
import { presentJson } from './lib/results-presenter.js';
import { generateRunId } from './lib/utils.js';
import {
    init, setRunning, updateProgress, updatePluginStatus,
    setResults, renderHistory, showErrorState,
} from './lib/ui-manager.js';

let historyManager = null;

// ===== Helpers =====

/** @returns {boolean} */
function isJsonMode() {
    return new URLSearchParams(window.location.search).get('format') === 'json';
}

/** @returns {string[]} */
function detectBrowserSupport() {
    const warnings = [];
    if (typeof performance === 'undefined'
        || typeof performance.now === 'undefined') {
        warnings.push('Your browser does not support the Performance API '
            + 'needed for speed measurements. '
            + 'Please try Chrome, Firefox, Safari, or Edge.');
    }
    try {
        const k = '__td_storage_test__';
        localStorage.setItem(k, k);
        localStorage.removeItem(k);
    } catch {
        warnings.push('Cannot save test history — browser storage is '
            + 'full or disabled.');
    }
    return warnings;
}

/** @returns {Promise<object>} */
async function ensureHistoryManager() {
    if (historyManager) {
        return historyManager;
    }
    const mod = await import('./lib/history-manager.js');
    historyManager = {
        save: mod.save, loadAll: mod.loadAll, getByRunId: mod.getByRunId,
        deleteRun: mod.deleteRun, deleteAll: mod.deleteAll,
    };
    return historyManager;
}

/**
 * Collects results, analyzes them, presents output.
 *
 * @param {import('./lib/types.js').TestResult[]} results
 * @param {string[]} extraWarnings
 */
function finalizeTestRun(results, extraWarnings) {
    const { baseline, discrepancies, verdict } = analyzeResults(results);
    const testRun = {
        runId: generateRunId(),
        timestamp: new Date().toISOString(),
        results,
        baselinePluginId: baseline ? baseline.pluginId : null,
        discrepancies,
        verdict,
        warnings: extraWarnings,
    };
    setResults(testRun);
    return testRun;
}

/** @param {import('./lib/types.js').TestRun} testRun */
async function persistAndRefreshHistory(testRun) {
    try {
        const hm = await ensureHistoryManager();
        hm.save(testRun);
        renderHistory(hm.loadAll());
    } catch {
        // History persistence failed — non-critical; continue without saving
        void 0;
    }
}

/**
 * Loads and displays a specific history entry.
 *
 * @param {string} runId
 */
async function loadHistoryEntry(runId) {
    try {
        const hm = await ensureHistoryManager();
        const entries = hm.loadAll();
        const entry = entries.find((e) => e.runId === runId);
        if (!entry) {
            return;
        }

        const { baseline, discrepancies, verdict } = analyzeResults(
            entry.results
        );
        const testRun = {
            runId: entry.runId, timestamp: entry.timestamp,
            results: entry.results, baselinePluginId: baseline
                ? baseline.pluginId : null,
            discrepancies, verdict, warnings: [],
        };
        setResults(testRun);
    } catch {
        // History load failed — non-critical; showing current state only
        void 0;
    }
}

/**
 * Announces a deletion message to the screen reader aria-live region.
 *
 * @param {string} msg
 */
function announceDeletion(msg) {
    const live = document.getElementById('status-live');
    if (!live) {
        return;
    }
    live.textContent = '';
    requestAnimationFrame(() => {
        live.textContent = msg;
    });
}

/**
 * Deletes a single history entry by runId and refreshes the UI.
 *
 * @param {string} runId
 */
async function deleteHistoryEntry(runId) {
    try {
        const hm = await ensureHistoryManager();
        hm.deleteRun(runId);
        renderHistory(hm.loadAll());
        announceDeletion('Test run deleted');
    } catch {
        void 0;
    }
}

/**
 * Deletes all history entries and refreshes the UI.
 */
async function deleteAllHistory() {
    try {
        const hm = await ensureHistoryManager();
        const deletedCount = hm.deleteAll();
        renderHistory(hm.loadAll());
        announceDeletion(`${deletedCount} test runs deleted`);
    } catch {
        void 0;
    }
}

// ===== Core Logic =====

/** Runs a speed test using all registered plugins. */
async function startTest() {
    const plugins = getPlugins();
    if (plugins.length === 0) {
        showErrorState(['No test plugins found. Please reload the page.']);
        return;
    }

    setRunning(plugins);

    const config = { timeoutMs: 30000, sampleDurationMs: 10000,
        adaptivePayload: true };
    const extraWarnings = [];

    try {
        const results = await runAll(plugins, config);
        updateProgress(results.length, plugins.length);
        for (const result of results) {
            updatePluginStatus(result.pluginId, result.status === 'success');
        }
        const testRun = finalizeTestRun(results, extraWarnings);
        await persistAndRefreshHistory(testRun);
    } catch (error) {
        showErrorState([`Test run failed: ${error.message || 'Unknown error'}`]);
    }
}

// ===== Bootstrap =====

async function bootstrapJsonMode() {
    try {
        const hm = await ensureHistoryManager();
        const history = hm.loadAll();
        if (history.length > 0) {
            const latest = history[0];
            const { baseline, discrepancies, verdict } = analyzeResults(
                latest.results
            );
            const run = {
                runId: latest.runId, timestamp: latest.timestamp,
                results: latest.results,
                baselinePluginId: baseline ? baseline.pluginId : null,
                discrepancies, verdict, warnings: [],
            };
            document.body.textContent = presentJson(run);
        } else {
            document.body.textContent = presentJson(null);
        }
    } catch {
        document.body.textContent = presentJson(null);
    }
}

async function bootstrapHtmlMode(warnings) {
    const nonCritical = warnings.filter(
        (warning) => !warning.includes('Performance API')
    );
    init({
        onRunTest: startTest,
        onHistoryClick: loadHistoryEntry,
        onHistoryDelete: deleteHistoryEntry,
        onHistoryDeleteAll: deleteAllHistory,
        warnings: nonCritical,
    });

    try {
        const hm = await ensureHistoryManager();
        renderHistory(hm.loadAll());
    } catch {
        renderHistory([]);
    }
}

async function bootstrap() {
    const warnings = detectBrowserSupport();
    const critical = warnings.some((warning) =>
        warning.includes('Performance API'));

    if (critical) {
        if (isJsonMode()) {
            document.body.textContent = JSON.stringify({
                error: 'unsupported_browser', message: warnings[0],
            }, null, 2);
        } else {
            const main = document.getElementById('main-content');
            if (main) {
                main.innerHTML = `<div class="error-state" role="alert">
                    <span class="error-state-icon" aria-hidden="true">\u26A0\uFE0F</span>
                    <h2>Unsupported Browser</h2>
                    <p>${warnings[0]}</p></div>`;
            }
        }
        return;
    }

    if (isJsonMode()) {
        await bootstrapJsonMode();
        return;
    }

    bootstrapHtmlMode(warnings);
}

bootstrap().catch((err) => {
    const main = document.getElementById('main-content');
    if (main) {
        main.innerHTML = `<div class="error-state" role="alert">
            <span class="error-state-icon" aria-hidden="true">\u274C</span>
            <h2>Application Error</h2>
            <p>${err.message || 'An unexpected error occurred'}</p></div>`;
    }
});
