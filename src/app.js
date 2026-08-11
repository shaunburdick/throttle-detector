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
import { save, loadAll, deleteRun, deleteAll } from './lib/history-manager.js';
import {
    init, setRunning, updateProgress, updatePluginStatus,
    setResults, renderHistory, showErrorState, markPluginRunning,
    buildErrorHtml,
} from './lib/ui-manager.js';

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
        save(testRun);
        renderHistory(loadAll());
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
        const entries = loadAll();
        const entry = entries.find((e) => e.runId === runId);
        if (!entry) {
            return;
        }

        // C-1: Slim entries have been trimmed to fit storage
        if (entry.stripped) {
            const testRun = {
                runId: entry.runId,
                timestamp: entry.timestamp,
                results: [],
                baselinePluginId: null,
                discrepancies: [],
                verdict: {
                    level: 'no_data',
                    message: entry.summary,
                    affectedServices: [],
                    indicator: 'gray',
                },
                warnings: [],
            };
            setResults(testRun);
            return;
        }

        // M-4: Use cached discrepancies/verdict when available
        if (entry.discrepancies && entry.verdict) {
            const testRun = {
                runId: entry.runId,
                timestamp: entry.timestamp,
                results: entry.results,
                baselinePluginId: entry.baselinePluginId || null,
                discrepancies: entry.discrepancies,
                verdict: entry.verdict,
                warnings: [],
            };
            setResults(testRun);
            return;
        }

        // Fallback for legacy entries without cached fields
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
        deleteRun(runId);
        renderHistory(loadAll());
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
        const deletedCount = deleteAll();
        renderHistory(loadAll());
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
        const results = await runAll({
            plugins,
            config,
            onProgress: ({ done, total, pluginId, success }) => {
                updateProgress(done, total);
                updatePluginStatus(pluginId, success);
            },
            onPluginStart: (pluginId) => markPluginRunning(pluginId),
        });
        const testRun = finalizeTestRun(results, extraWarnings);
        await persistAndRefreshHistory(testRun);
    } catch (error) {
        showErrorState([`Test run failed: ${error.message || 'Unknown error'}`]);
    }
}

// ===== Bootstrap =====

async function bootstrapJsonMode() {
    try {
        const history = loadAll();
        if (history.length > 0) {
            const latest = history[0];
            if (latest.stripped) {
                document.body.textContent = JSON.stringify({
                    results: [],
                    lastTestTimestamp: latest.timestamp,
                    baselineName: null,
                    verdict: {
                        level: 'no_data',
                        message: latest.summary || 'Results no longer available',
                    },
                    errors: [],
                }, null, 2);
                return;
            }
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
        renderHistory(loadAll());
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
                main.innerHTML = buildErrorHtml({
                    icon: '\u26A0\uFE0F',
                    title: 'Unsupported Browser',
                    message: warnings[0],
                });
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
        main.innerHTML = buildErrorHtml({
            icon: '\u274C',
            title: 'Application Error',
            message: err.message || 'An unexpected error occurred',
        });
    }
});
