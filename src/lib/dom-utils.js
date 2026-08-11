/**
 * DOM utility helpers — shared across UI modules.
 *
 * @module lib/dom-utils
 */

/** Shared element for HTML-escaping strings */
const _escapeDiv = document.createElement('div');

/**
 * Escapes HTML special characters to prevent XSS.
 *
 * Uses a live DOM element's textContent setter, which is the
 * browser-native way to HTML-encode arbitrary strings.
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
    _escapeDiv.textContent = str;
    return _escapeDiv.innerHTML;
}

/**
 * Announces a message to screen readers via the aria-live region.
 *
 * Clears the element first, then sets the message on the next
 * animation frame to ensure screen readers detect the change.
 *
 * @param {string} msg
 */
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
