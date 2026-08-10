/**
 * UI Manager — DOM manipulation, state, events.
 *
 * @module lib/ui-manager
 */

import { formatTimestamp } from './utils.js';

// ===== State =====

let currentState = 'initial';
let onRunTestCb = null;
let onHistoryClickCb = null;
let onHistoryDeleteCb = null;
let onHistoryDeleteAllCb = null;

// ===== Helpers =====

/** @param {string} str @returns {string} */
function esc(str) {
    const element = document.createElement('div');
    element.textContent = str;
    return element.innerHTML;
}

/** @param {string} str @returns {string} */
function escAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** @param {string} msg */
function announce(msg) {
    const live = document.getElementById('status-live');
    if (!live) {
        return;
    }
    live.textContent = '';
    requestAnimationFrame(() => {
        live.textContent = msg;
    });
}

/** @param {boolean} disabled */
function updateBtn(disabled) {
    const btn = document.getElementById('run-test-btn');
    if (!btn) {
        return;
    }
    btn.disabled = disabled;
    btn.textContent = disabled ? 'Testing...' : 'Run Test';
}

const RESULTS_AREA_ID = 'results-area';
const HISTORY_AREA_ID = 'history-area';
const STATUS_LIVE_ID = 'status-live';
const RUN_BTN_ID = 'run-test-btn';

// ===== Render =====

/** @param {string[]} warnings */
function render(warnings) {
    const main = document.getElementById('main-content');
    if (!main) {
        return;
    }

    let html = '<div class="status-live" aria-live="polite"'
        + ` id="${STATUS_LIVE_ID}"></div>`;
    for (const warning of warnings) {
        html += '<div class="warning-banner" role="alert">'
            + '<span aria-hidden="true">\u26A0\uFE0F</span> '
            + `${esc(warning)}</div>`;
    }

    const running = currentState === 'running';
    const btnDisabled = running ? ' disabled' : '';
    const btnText = running ? 'Testing...' : 'Run Test';
    html += '<div class="controls">'
        + `<button class="btn btn-primary" id="${RUN_BTN_ID}"`
        + `${btnDisabled}>${btnText}</button></div>`;
    html += `<div id="${RESULTS_AREA_ID}"></div>`
        + `<div id="${HISTORY_AREA_ID}"></div>`;
    main.innerHTML = html;

    const btn = document.getElementById(RUN_BTN_ID);
    if (btn && onRunTestCb) {
        btn.addEventListener('click', () => {
            if (currentState !== 'running') {
                onRunTestCb();
            }
        });
    }
}

// ===== Exports =====

/**
 * @param {{ onRunTest: Function, onHistoryClick?: Function,
 *     onHistoryDelete?: Function, onHistoryDeleteAll?: Function,
 *     warnings?: string[] }} opts
 */
export function init(
    { onRunTest, onHistoryClick, onHistoryDelete, onHistoryDeleteAll, warnings = [] }
) {
    onRunTestCb = onRunTest;
    onHistoryClickCb = onHistoryClick;
    onHistoryDeleteCb = onHistoryDelete;
    onHistoryDeleteAllCb = onHistoryDeleteAll;
    currentState = 'initial';
    render(warnings);
}

export function getState() {
    return currentState;
}

/** @param {import('./types.js').TestPlugin[]} plugins */
export function setRunning(plugins) {
    currentState = 'running';
    updateBtn(true);
    announce(`Running ${plugins.length} speed tests...`);

    const area = document.getElementById(RESULTS_AREA_ID);
    if (!area) {
        return;
    }

    let items = '';
    for (const plugin of plugins) {
        items += '<li class="test-status-item"'
            + ` data-plugin-id="${escAttr(plugin.id)}">`
            + '<span class="test-status-icon test-status-icon--running"'
            + ' aria-hidden="true">\u23F3</span>'
            + `<span>${esc(plugin.name)}</span>`
            + '<span class="test-status-label">Running...</span></li>';
    }

    area.innerHTML = '<div class="progress-container">'
        + '<div class="progress-bar" role="progressbar" aria-valuenow="0"'
        + ` aria-valuemin="0" aria-valuemax="${plugins.length}"`
        + ' aria-label="Test progress">'
        + '<div class="progress-bar-fill" style="width: 0%"></div></div>'
        + `<p class="progress-text">0 of ${plugins.length} tests complete</p>`
        + '</div><ul class="test-status-list" aria-label="Test progress">'
        + `${items}</ul>`;
}

const PERCENTAGE_MULTIPLIER = 100;

/** @type {number} Tracks last announced completion count for debouncing */
let lastAnnouncedDone = 0;

/** @type {number} Tracks last announcement timestamp for rate limiting */
let lastProgressAnnounce = 0;

/** Minimum interval between progress announcements (ms) */
const PROGRESS_ANNOUNCE_THROTTLE_MS = 1000;

/** @param {number} done @param {number} total */
export function updateProgress(done, total) {
    const pct = total > 0
        ? Math.round((done / total) * PERCENTAGE_MULTIPLIER) : 0;
    const bar = document.querySelector('.progress-bar');
    const txt = document.querySelector('.progress-text');
    const fill = document.querySelector('.progress-bar-fill');
    if (bar) {
        bar.setAttribute('aria-valuenow', String(done));
    }
    if (fill) {
        fill.style.width = `${pct}%`;
    }
    if (txt) {
        txt.textContent = `${done} of ${total} tests complete`;
    }

    // Debounced screen reader announcement: once per 2 completions or once per second
    const now = Date.now();
    if (done - lastAnnouncedDone >= 2 || now - lastProgressAnnounce >= PROGRESS_ANNOUNCE_THROTTLE_MS) {
        announce(`${done} of ${total} tests complete`);
        lastAnnouncedDone = done;
        lastProgressAnnounce = now;
    }
}

/** @param {string} pluginId @param {boolean} ok */
export function updatePluginStatus(pluginId, ok) {
    const item = document.querySelector(`[data-plugin-id="${escAttr(pluginId)}"]`);
    if (!item) {
        return;
    }
    const icon = item.querySelector('.test-status-icon');
    const label = item.querySelector('.test-status-label');
    if (icon) {
        icon.className = `test-status-icon ${ok ? 'test-status-icon--complete' : 'test-status-icon--error'}`;
        icon.textContent = ok ? '\u2705' : '\u274C';
    }
    if (label) {
        label.textContent = ok ? 'Complete' : 'Error';
    }
}

/** @param {import('./types.js').TestRun} run */
export async function setResults(run) {
    const allFailed = run.results.every((res) => res.status !== 'success');
    currentState = allFailed ? 'error-full' : 'complete';
    updateBtn(false);

    const area = document.getElementById(RESULTS_AREA_ID);
    if (!area) {
        return;
    }

    try {
        const { presentHtml } = await import('./results-presenter.js');
        area.innerHTML = presentHtml(run);
    } catch {
        return;
    }

    // Move focus to results heading after content replacement
    const heading = area.querySelector('#results-heading');
    if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
    }

    const msg = run.verdict ? run.verdict.message : 'Tests complete';
    announce(`Tests complete. ${msg}`);
}

// ---- History rendering helpers ----

/** @param {HTMLElement} area */
function renderEmptyHistory(area) {
    area.innerHTML = '<section class="history-section">'
        + '<h2>Test History</h2>'
        + '<div class="empty-state">'
        + '<p>No tests run yet. '
        + 'Run your first test to start tracking your connection.</p>'
        + '</div></section>';
}

/**
 * Shows a confirmation dialog using the native browser confirm() for simplicity
 * and screen-reader accessibility.
 *
 * @param {string} message
 * @returns {boolean}
 */
function confirmDeletion(message) {
    return window.confirm(message);
}

/**
 * Builds the HTML string for the history list.
 *
 * @param {import('./types.js').HistoryEntry[]} entries
 * @param {number} count
 * @returns {string}
 */
function buildHistoryHtml(entries, count) {
    const deleteAllHtml = onHistoryDeleteAllCb
        ? '<button class="btn-delete-all"'
            + ' aria-label="Delete all test runs">'
            + `Delete All (${count})</button>`
        : '';

    let items = '';
    for (const entry of entries) {
        const deleteBtnHtml = onHistoryDeleteCb
            ? '<button class="btn-delete-history"'
                + ` data-run-id="${escAttr(entry.runId)}"`
                + ` aria-label="Delete test run from ${formatTimestamp(entry.timestamp)}">`
                + '\u00D7</button>'
            : '';
        items += '<li class="history-list-item">'
            + '<button class="history-entry"'
            + ` aria-label="Test run from ${formatTimestamp(entry.timestamp)}"`
            + ` data-run-id="${escAttr(entry.runId)}">`
            + '<span class="history-entry-summary">'
            + `${esc(entry.summary)}</span>`
            + '<span class="history-entry-timestamp">'
            + `${formatTimestamp(entry.timestamp)}</span></button>`
            + `${deleteBtnHtml}</li>`;
    }

    return '<section class="history-section"'
        + ' aria-labelledby="history-heading">'
        + '<div class="history-header">'
        + '<h2 id="history-heading">Test History</h2>'
        + `${deleteAllHtml}</div>`
        + `<ul class="history-list" role="list">${items}</ul></section>`;
}

/** @param {HTMLElement} area */
function wireHistoryEntries(area) {
    for (const el of area.querySelectorAll('.history-entry')) {
        el.addEventListener('click', () => {
            if (onHistoryClickCb) {
                onHistoryClickCb(el.getAttribute('data-run-id'));
            }
        });
    }
}

/** @param {HTMLElement} area */
function wireDeleteButtons(area) {
    for (const el of area.querySelectorAll('.btn-delete-history')) {
        el.addEventListener('click', (event) => {
            event.stopPropagation();
            const runId = el.getAttribute('data-run-id');
            if (!runId || !onHistoryDeleteCb) {
                return;
            }
            if (confirmDeletion('Delete this test run?')) {
                onHistoryDeleteCb(runId);
            }
        });
    }
}

/** @param {import('./types.js').HistoryEntry[]} entries */
export function renderHistory(entries) {
    const area = document.getElementById(HISTORY_AREA_ID);
    if (!area) {
        return;
    }

    const count = entries ? entries.length : 0;

    if (!entries || count === 0) {
        renderEmptyHistory(area);
        return;
    }

    area.innerHTML = buildHistoryHtml(entries, count);

    wireHistoryEntries(area);
    wireDeleteButtons(area);

    const deleteAllBtn = area.querySelector('.btn-delete-all');
    if (deleteAllBtn && onHistoryDeleteAllCb) {
        deleteAllBtn.addEventListener('click', () => {
            if (confirmDeletion(`Delete all ${count} test runs?`)) {
                onHistoryDeleteAllCb();
            }
        });
    }
}

/** @param {string[]} reasons */
export function showErrorState(reasons) {
    currentState = 'error-full';
    updateBtn(false);

    const area = document.getElementById(RESULTS_AREA_ID);
    if (!area) {
        return;
    }

    const items = reasons.map((reason) => `<li>${esc(reason)}</li>`).join('');
    area.innerHTML = '<div class="error-state" role="alert">'
        + '<span class="error-state-icon" aria-hidden="true">\u274C</span>'
        + '<h2>Unable to Determine</h2>'
        + '<p>Tests could not complete.</p>'
        + '<ul style="text-align:left;max-width:400px;margin:0 auto">'
        + `${items}</ul></div>`;
    announce('Tests failed. Unable to determine throttling.');
}
