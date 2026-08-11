/**
 * History UI — history rendering and inline confirmation dialog.
 *
 * Extracted from ui-manager.js to keep modules within the 500-line
 * limit from eslint-config-shaunburdick.
 *
 * @module lib/history-ui
 */

import { formatTimestamp } from './utils.js';
import { escapeHtml, announce } from './dom-utils.js';

// ===== Private Helpers =====

/** @param {string} str @returns {string} */
function escAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
export function showInlineConfirm(triggerEl, message, onConfirm) {
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
 * @param {{ onHistoryDelete?: Function|null, onHistoryDeleteAll?: Function|null }} callbacks
 * @returns {string}
 */
function buildHistoryHtml(entries, count, { onHistoryDelete, onHistoryDeleteAll }) {
    const deleteAllHtml = onHistoryDeleteAll
        ? '<button class="btn-delete-all"'
            + ' aria-label="Delete all test runs">'
            + `Delete All (${count})</button>`
        : '';

    let items = '';
    for (const entry of entries) {
        const deleteBtnHtml = onHistoryDelete
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

/**
 * Wires click handlers on history entry buttons.
 *
 * @param {HTMLElement} area
 * @param {{ onHistoryClick?: Function|null }} callbacks
 */
function wireHistoryEntries(area, { onHistoryClick }) {
    for (const el of area.querySelectorAll('.history-entry')) {
        el.addEventListener('click', () => {
            if (onHistoryClick) {
                onHistoryClick(el.getAttribute('data-run-id'));
            }
        });
    }
}

/**
 * Wires delete buttons with inline confirmation dialogs.
 *
 * @param {HTMLElement} area
 * @param {{ onHistoryDelete?: Function|null }} callbacks
 */
function wireDeleteButtons(area, { onHistoryDelete }) {
    for (const el of area.querySelectorAll('.btn-delete-history')) {
        el.addEventListener('click', (event) => {
            event.stopPropagation();
            const runId = el.getAttribute('data-run-id');
            if (!runId || !onHistoryDelete) {
                return;
            }
            showInlineConfirm(el, 'Delete this run?', () => {
                onHistoryDelete(runId);
            });
        });
    }
}

// ===== Public API =====

/**
 * Renders the test history list into a given DOM area.
 *
 * This is the low-level implementation. The ui-manager wrapper provides
 * the area element and closure-captured callbacks.
 *
 * @param {import('./types.js').HistoryEntry[]} entries
 * @param {HTMLElement} area
 * @param {{ onHistoryClick?: Function|null, onHistoryDelete?: Function|null,
 *   onHistoryDeleteAll?: Function|null }} callbacks
 */
export function renderHistory(entries, area, { onHistoryClick, onHistoryDelete, onHistoryDeleteAll }) {
    const count = entries ? entries.length : 0;

    if (!entries || count === 0) {
        renderEmptyHistory(area);
        return;
    }

    area.innerHTML = buildHistoryHtml(entries, count, { onHistoryDelete, onHistoryDeleteAll });

    wireHistoryEntries(area, { onHistoryClick });
    wireDeleteButtons(area, { onHistoryDelete });

    const deleteAllBtn = area.querySelector('.btn-delete-all');
    if (deleteAllBtn && onHistoryDeleteAll) {
        deleteAllBtn.addEventListener('click', () => {
            showInlineConfirm(deleteAllBtn, `Delete all ${count} runs?`, () => {
                onHistoryDeleteAll();
            });
        });
    }
}
