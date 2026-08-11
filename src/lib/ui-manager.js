/**
 * UI Manager — DOM manipulation, state, events.
 *
 * @module lib/ui-manager
 */

import { formatTimestamp } from './utils.js';
import { presentHtml } from './results-presenter.js';
import { escapeHtml } from './dom-utils.js';
import { getPlugins } from './plugin-registry.js';

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

/** @param {string} msg */
export function announce(msg) {
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

/**
 * Renders HTML for the plugin selection checklist.
 *
 * Each plugin gets a checkbox (native input) wrapped in a label.
 * When `disabled` is true, checkboxes are disabled (during test runs).
 * When `disabled` is false, checkboxes default to checked.
 *
 * @param {import('./types.js').TestPlugin[]} plugins
 * @param {boolean} disabled
 * @returns {string}
 */
function renderPluginChecklist(plugins, disabled) {
    let items = '';
    const checkedAttr = disabled ? '' : ' checked';
    const disabledAttr = disabled ? ' disabled' : '';
    for (const plugin of plugins) {
        items += '<li class="plugin-check-item">'
            + '<label class="plugin-check-label">'
            + '<input type="checkbox" class="plugin-select-checkbox"'
            + `${disabledAttr}${checkedAttr}`
            + ` data-plugin-id="${escAttr(plugin.id)}">`
            + `${escapeHtml(plugin.name)}</label>`
            + `<span class="badge badge-neutral" style="font-size:0.75rem">${escapeHtml(plugin.category)}</span></li>`;
    }
    const count = plugins.length;
    return '<section class="plugin-checklist" aria-label="Test target selection">'
        + `<p class="plugin-checklist-count">${count} test target${count !== 1 ? 's' : ''} available</p>`
        + `<ul class="plugin-check-list" role="group" aria-label="Select test targets">${items}</ul>`
        + '</section>';
}

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
    const checklistHtml = renderPluginChecklist(plugins, false);

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

    const checklistHtml = renderPluginChecklist(plugins, true);

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

    const checklistHtml = renderPluginChecklist(lastPlugins.length > 0 ? lastPlugins : getPlugins(), false);
    area.innerHTML = checklistHtml + presentHtml(run);

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
 * Creates a focus-trap keydown handler for inline confirm dialogs.
 *
 * Cycles focus between the Yes and Cancel buttons on Tab/Shift+Tab.
 * Calls `onEscape` when Escape is pressed.
 *
 * @param {HTMLButtonElement} yesBtn
 * @param {HTMLButtonElement} cancelBtn
 * @param {() => void} onEscape
 * @returns {(event: KeyboardEvent) => void}
 */
function createConfirmFocusTrap(yesBtn, cancelBtn, onEscape) {
    return function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onEscape();
            return;
        }
        if (event.key === 'Tab') {
            const buttons = [yesBtn, cancelBtn];
            const currentIndex = buttons.indexOf(document.activeElement);
            let nextIndex;
            if (event.shiftKey) {
                nextIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
            } else {
                nextIndex = currentIndex >= buttons.length - 1 ? 0 : currentIndex + 1;
            }
            event.preventDefault();
            buttons[nextIndex].focus();
        }
    };
}

/**
 * Replaces the trigger element with an inline confirmation UI.
 * Calls onConfirm when "Yes" is clicked; restores the original element
 * when "Cancel" is clicked, Escape is pressed, or user clicks outside.
 *
 * @param {HTMLElement} triggerEl - Element to replace with confirmation
 * @param {string} message - Confirmation message text
 * @param {() => void} onConfirm - Called when user confirms deletion
 */
function showInlineConfirm(triggerEl, message, onConfirm) {
    const wrapper = document.createElement('span');
    wrapper.className = 'inline-confirm';
    wrapper.setAttribute('role', 'status');

    const msgEl = document.createElement('span');
    msgEl.className = 'inline-confirm-message';
    msgEl.textContent = message;

    const yesBtn = document.createElement('button');
    yesBtn.className = 'btn-confirm-yes';
    yesBtn.textContent = 'Yes';
    yesBtn.setAttribute('aria-label', 'Confirm deletion');

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-confirm-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel deletion');

    wrapper.appendChild(msgEl);
    wrapper.appendChild(yesBtn);
    wrapper.appendChild(cancelBtn);

    let cancelled = false;

    /** Restores the original element and returns focus to it. */
    function restore() {
        if (cancelled) {
            return;
        }
        cancelled = true;
        if (!triggerEl.parentNode) {
            wrapper.replaceWith(triggerEl);
        }
        triggerEl.focus();
        announce('Deletion cancelled.');
    }

    /**
     * Click-outside-to-dismiss: if user clicks anywhere outside the
     * inline confirm wrapper, restore the original element.
     *
     * Self-cleans if the wrapper is detached or cancelled, removing
     * itself from the document listener list.
     *
     * @param {MouseEvent} event
     */
    function onDocumentClick(event) {
        if (cancelled || !wrapper.isConnected) {
            document.removeEventListener('click', onDocumentClick);
            return;
        }
        if (!wrapper.contains(event.target)) {
            restore();
        }
    }

    yesBtn.addEventListener('click', () => {
        cancelled = true;
        document.removeEventListener('click', onDocumentClick);
        onConfirm();
    });

    cancelBtn.addEventListener('click', restore);
    wrapper.addEventListener('keydown', createConfirmFocusTrap(yesBtn, cancelBtn, restore));
    document.addEventListener('click', onDocumentClick);

    triggerEl.replaceWith(wrapper);
    cancelBtn.focus();
    announce('Confirm deletion requested.');
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
            + `${escapeHtml(entry.summary)}</span>`
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
            showInlineConfirm(el, 'Delete this run?', () => {
                onHistoryDeleteCb(runId);
            });
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
            showInlineConfirm(deleteAllBtn, `Delete all ${count} runs?`, () => {
                onHistoryDeleteAllCb();
            });
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

    const plugins = lastPlugins.length > 0 ? lastPlugins : getPlugins();
    const checklistHtml = renderPluginChecklist(plugins, false);

    area.innerHTML = checklistHtml + buildErrorHtml({
        icon: '\u274C',
        title: 'Unable to Determine',
        message: 'Tests could not complete.',
        items: reasons,
    });
    announce('Tests failed. Unable to determine throttling.');
}
