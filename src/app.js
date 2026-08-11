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
import { escapeHtml } from './lib/dom-utils.js';
import {
    init, setRunning, updateProgress, updatePluginStatus,
    setResults, renderHistory, showErrorState, markPluginRunning,
    buildErrorHtml, announce,
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
 * Deletes a single history entry by runId and refreshes the UI.
 *
 * @param {string} runId
 */
async function deleteHistoryEntry(runId) {
    try {
        deleteRun(runId);
        renderHistory(loadAll());
        announce('Test run deleted');
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
        announce(`${deletedCount} test runs deleted`);
    } catch {
        void 0;
    }
}

// ===== Core Logic =====

/** Runs a speed test using selected plugins. */
async function startTest() {
    const allPlugins = getPlugins();
    if (allPlugins.length === 0) {
        showErrorState(['No test plugins found. Please reload the page.']);
        return;
    }

    // Read checkbox state to determine which plugins are selected
    const checkboxes = document.querySelectorAll('.plugin-select-checkbox');
    let selectedPlugins = allPlugins;
    if (checkboxes.length > 0) {
        const checkedIds = new Set();
        for (const cb of checkboxes) {
            if (cb.checked) {
                checkedIds.add(cb.getAttribute('data-plugin-id'));
            }
        }
        selectedPlugins = allPlugins.filter((plugin) => checkedIds.has(plugin.id));

        // If nothing is selected, show error
        if (selectedPlugins.length === 0) {
            showErrorState(['Select at least one test target to run.']);
            announce('Select at least one test target to run.');
            return;
        }

        // Announce selection count
        const total = allPlugins.length;
        const selected = selectedPlugins.length;
        announce(`${selected} of ${total} test targets selected`);
    }

    setRunning(selectedPlugins);

    const config = { timeoutMs: 30000, sampleDurationMs: 10000,
        adaptivePayload: true };
    const extraWarnings = [];

    try {
        const results = await runAll({
            plugins: selectedPlugins,
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

/**
 * Theme management state and helpers.
 *
 * @module app (theme section)
 */

/** localStorage key for persisted theme preference */
const THEME_KEY = 'throttle-detector-theme';

/** Valid theme values */
const THEME_AUTO = 'auto';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

/** Unicode icons for each theme state */
const THEME_ICONS = {
    [THEME_AUTO]: '\u2699',   // gear / system
    [THEME_LIGHT]: '\u2600',  // sun
    [THEME_DARK]: '\u263E',   // moon
};

/** @type {string} */
let currentTheme = THEME_AUTO;

/**
 * Returns the effective color scheme, resolving 'auto' against the
 * system `prefers-color-scheme` media query.
 *
 * @returns {'light'|'dark'}
 */
function getEffectiveTheme() {
    if (currentTheme === THEME_AUTO) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches
            ? THEME_DARK : THEME_LIGHT;
    }
    return currentTheme;
}

/**
 * Applies the theme to the document by setting or removing the
 * `data-theme` attribute on `<html>`.
 */
function applyTheme() {
    const effective = getEffectiveTheme();
    if (effective === THEME_DARK) {
        document.documentElement.setAttribute('data-theme', THEME_DARK);
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

/**
 * Updates the toggle button label and aria-label to reflect the
 * current theme selection.
 */
function updateThemeButton() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) {
        return;
    }
    const icon = btn.querySelector('.theme-toggle-label');
    if (icon) {
        icon.textContent = THEME_ICONS[currentTheme] || THEME_ICONS[THEME_AUTO];
    }
    btn.setAttribute('aria-label', `Theme: ${currentTheme} (click to cycle)`);
}

/** Saves the current theme choice to localStorage. */
function saveTheme() {
    try {
        localStorage.setItem(THEME_KEY, currentTheme);
    } catch {
        // Storage unavailable — non-critical
        void 0;
    }
}

/**
 * Cycles the theme: auto → dark → light → auto.
 * Applies, saves, and updates the button.
 */
function cycleTheme() {
    if (currentTheme === THEME_AUTO) {
        currentTheme = THEME_DARK;
    } else if (currentTheme === THEME_DARK) {
        currentTheme = THEME_LIGHT;
    } else {
        currentTheme = THEME_AUTO;
    }
    applyTheme();
    saveTheme();
    updateThemeButton();
}

/**
 * Initializes theme management:
 * 1. Reads saved preference from localStorage
 * 2. Applies the correct `data-theme` attribute
 * 3. Wires the toggle button
 * 4. Listens for system preference changes (when in auto mode)
 */
function initTheme() {
    // Restore saved preference
    try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === THEME_LIGHT || saved === THEME_DARK || saved === THEME_AUTO) {
            currentTheme = saved;
        }
    } catch {
        // Storage unavailable — use default (auto)
        void 0;
    }

    applyTheme();
    updateThemeButton();

    // Wire toggle button
    const btn = document.getElementById('theme-toggle');
    if (btn) {
        btn.addEventListener('click', cycleTheme);
    }

    // Listen for system preference changes
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    darkQuery.addEventListener('change', () => {
        if (currentTheme === THEME_AUTO) {
            applyTheme();
        }
    });
}

// ---- Bootstrap continuation ---

/**
 * Generates a timestamp string for export filenames (YYYYMMDD-HHmmss).
 *
 * @returns {string}
 */
function exportTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}-${hour}${minute}${second}`;
}

/**
 * Triggers a JSON file download in the browser.
 *
 * @param {string} json - The JSON string to download
 * @param {string} filename - The desired filename
 */
function triggerDownload(json, filename) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

/**
 * Renders JSON output with a download button for JSON mode (?format=json).
 *
 * @param {string} json - The presentJson() output string
 */
function renderJsonModePage(json) {
    const filename = `throttle-test-${exportTimestamp()}.json`;
    document.body.innerHTML = '<style>'
        + 'body{font-family:monospace;background:#1a1a2e;color:#e0e0e0;'
        + 'margin:0;padding:1.5rem}'
        + 'pre{white-space:pre-wrap;word-break:break-all;'
        + 'max-height:70vh;overflow:auto;background:#242442;'
        + 'padding:1rem;border-radius:0.5rem;margin:1rem 0}'
        + '.json-download-btn{display:inline-flex;align-items:center;'
        + 'gap:0.5rem;padding:0.75rem 1.5rem;font-size:1rem;'
        + 'font-weight:600;border:none;border-radius:0.5rem;'
        + 'background:#4da6ff;color:#1a1a2e;cursor:pointer;'
        + 'min-height:44px;font-family:inherit}'
        + '.json-download-btn:hover{background:#66b3ff}'
        + '.json-download-btn:focus-visible{outline:3px solid #4da6ff;outline-offset:2px}'
        + '</style>'
        + '<button class="json-download-btn" aria-label="Download test results as JSON file">'
        + 'Export JSON</button>'
        + `<pre>${escapeHtml(json)}</pre>`;

    const btn = document.querySelector('.json-download-btn');
    if (btn) {
        btn.addEventListener('click', () => triggerDownload(json, filename));
    }
}

async function bootstrapJsonMode() {
    try {
        const history = loadAll();
        if (history.length > 0) {
            const latest = history[0];
            if (latest.stripped) {
                const strippedJson = JSON.stringify({
                    results: [],
                    lastTestTimestamp: latest.timestamp,
                    baselineName: null,
                    verdict: {
                        level: 'no_data',
                        message: latest.summary || 'Results no longer available',
                    },
                    errors: [],
                }, null, 2);
                renderJsonModePage(strippedJson);
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
            renderJsonModePage(presentJson(run));
        } else {
            renderJsonModePage(presentJson(null));
        }
    } catch {
        renderJsonModePage(presentJson(null));
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
    initTheme();

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
