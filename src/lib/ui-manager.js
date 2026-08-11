/**
 * UI Manager — DOM manipulation, state, events.
 *
 * @module lib/ui-manager
 */

import { presentHtml, presentPluginChecklist } from './results-presenter.js';
import { escapeHtml, announce as _announce } from './dom-utils.js';
import { getPlugins } from './plugin-registry.js';
import { renderHistory as renderHistoryImpl } from './history-ui.js';

// Re-export announce for backward compatibility (app.js imports it from here)
export const announce = _announce;

// ===== State =====

let currentState = 'initial';
let onRunTestCb = null;
let onHistoryClickCb = null;
let onHistoryDeleteCb = null;
let onHistoryDeleteAllCb = null;

/** @type {import('./types.js').TestPlugin[]} Cached plugin list for re-rendering checklists */
let lastPlugins = [];

// ===== Helpers =====

/** @param {string} str @returns {string} */
function escAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

/**
 * Builds error state HTML for consistent rendering across the app.
 *
 * @param {object} opts
 * @param {string} opts.icon - Unicode emoji for the error icon
 * @param {string} opts.title - Heading text
 * @param {string} opts.message - Description paragraph
 * @param {string[]} [opts.items] - Optional list of detail items
 * @returns {string}
 */
export function buildErrorHtml({ icon, title, message, items }) {
    const itemList = items ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '';
    const listHtml = items && items.length > 0
        ? `<ul style="text-align:left;max-width:400px;margin:0 auto">${itemList}</ul>`
        : '';
    const iconSpan = `<span class="error-state-icon" aria-hidden="true">${icon}</span>`;
    const body = `${iconSpan}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>${listHtml}`;
    return `<div class="error-state" role="alert">${body}</div>`;
}

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
            + `${escapeHtml(warning)}</div>`;
    }

    const running = currentState === 'running';
    const btnDisabled = running ? ' disabled' : '';
    const btnText = running ? 'Testing...' : 'Run Test';
    html += '<div class="controls">'
        + `<button class="btn btn-primary" id="${RUN_BTN_ID}"`
        + `${btnDisabled}>${btnText}</button></div>`;

    // Show plugin checklist in the pre-run state
    const plugins = getPlugins();
    lastPlugins = plugins;
    const checklistHtml = presentPluginChecklist(plugins, false);

    html += `<div id="${RESULTS_AREA_ID}">${checklistHtml}</div>`
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
    lastPlugins = plugins;
    updateBtn(true);
    announce(`Running ${plugins.length} speed tests...`);

    const area = document.getElementById(RESULTS_AREA_ID);
    if (!area) {
        return;
    }

    const checklistHtml = presentPluginChecklist(plugins, true);

    let items = '';
    for (const plugin of plugins) {
        items += '<li class="test-status-item test-status-item--queued"'
            + ` data-plugin-id="${escAttr(plugin.id)}">`
            + '<span class="test-status-icon test-status-icon--queued"'
            + ' aria-hidden="true">\u23F3</span>'
            + `<span>${escapeHtml(plugin.name)}</span>`
            + `<span class="badge badge-neutral" style="font-size:0.75rem">${escapeHtml(plugin.category)}</span>`
            + '<span class="test-status-label">Queued</span></li>';
    }

    area.innerHTML = `${checklistHtml}`
        + '<div class="progress-container">'
        + '<div class="progress-bar" role="progressbar" aria-valuenow="0"'
        + ` aria-valuemin="0" aria-valuemax="${plugins.length}"`
        + ' aria-label="Test progress">'
        + '<div class="progress-bar-fill" style="width: 0%"></div></div>'
        + `<p class="progress-text">0 of ${plugins.length} tests complete</p>`
        + '</div><ul class="test-status-list" aria-label="Test progress">'
        + `${items}</ul>`;
}

/**
 * Transitions a plugin row from queued to running state.
 *
 * Replaces the clock icon with a spinning indicator and updates styling
 * so the user can see which plugin is currently active.
 *
 * @param {string} pluginId - The id of the plugin to mark as running
 */
export function markPluginRunning(pluginId) {
    const item = document.querySelector(`.test-status-item[data-plugin-id="${escAttr(pluginId)}"]`);
    if (!item) {
        return;
    }

    // Swap the item class
    item.classList.remove('test-status-item--queued');
    item.classList.add('test-status-item--running');

    // Swap the icon
    const icon = item.querySelector('.test-status-icon');
    if (icon) {
        icon.classList.remove('test-status-icon--queued');
        icon.classList.add('test-status-icon--running');
        icon.textContent = '';
    }

    // Update the label
    const label = item.querySelector('.test-status-label');
    if (label) {
        label.textContent = 'Running...';
    }
}

const PERCENT_SCALE = 100;

/** @type {number} Tracks last announced completion count for debouncing */
let lastAnnouncedDone = 0;

/** @type {number} Tracks last announcement timestamp for rate limiting */
let lastProgressAnnounce = 0;

/** Minimum interval between progress announcements (ms) */
const PROGRESS_ANNOUNCE_THROTTLE_MS = 1000;

/** @param {number} done @param {number} total */
export function updateProgress(done, total) {
    const pct = total > 0
        ? Math.round((done / total) * PERCENT_SCALE) : 0;
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
    const item = document.querySelector(`.test-status-item[data-plugin-id="${escAttr(pluginId)}"]`);
    if (!item) {
        return;
    }

    // Clear transitional states
    item.classList.remove('test-status-item--queued', 'test-status-item--running');

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
export function setResults(run) {
    const allFailed = run.results.every((res) => res.status !== 'success');
    currentState = allFailed ? 'error-full' : 'complete';
    updateBtn(false);

    const area = document.getElementById(RESULTS_AREA_ID);
    if (!area) {
        return;
    }

    const checklistHtml = presentPluginChecklist(lastPlugins.length > 0 ? lastPlugins : getPlugins(), false);

    const exportHtml = '<div class="export-section">'
        + '<button class="btn btn-primary export-json-btn"'
        + ' aria-label="View test results as JSON">'
        + 'Export JSON</button></div>';

    area.innerHTML = checklistHtml + presentHtml(run) + exportHtml;

    // Wire export button — navigates to ?format=json for in-browser display
    const exportBtn = area.querySelector('.export-json-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            window.location.href = '/?format=json';
        });
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

// ---- History rendering (delegates to history-ui.js) ----

/** @param {import('./types.js').HistoryEntry[]} entries */
export function renderHistory(entries) {
    const area = document.getElementById(HISTORY_AREA_ID);
    if (!area) {
        return;
    }

    renderHistoryImpl(entries, area, {
        onHistoryClick: onHistoryClickCb,
        onHistoryDelete: onHistoryDeleteCb,
        onHistoryDeleteAll: onHistoryDeleteAllCb,
    });
}

/** @param {string[]} reasons */
export function showErrorState(reasons) {
    currentState = 'error-full';
    updateBtn(false);

    const area = document.getElementById(RESULTS_AREA_ID);
    if (!area) {
        return;
    }

    const plugins = lastPlugins.length > 0 ? lastPlugins : getPlugins();
    const checklistHtml = presentPluginChecklist(plugins, false);

    area.innerHTML = checklistHtml + buildErrorHtml({
        icon: '\u274C',
        title: 'Unable to Determine',
        message: 'Tests could not complete.',
        items: reasons,
    });
    announce('Tests failed. Unable to determine throttling.');
}
