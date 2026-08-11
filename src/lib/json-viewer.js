/**
 * JSON Viewer Page — renders the formatted JSON viewer at ?view=json&id={runId}.
 *
 * @module lib/json-viewer
 */

import { escapeHtml } from './dom-utils.js';
import { getByRunId } from './history-manager.js';
import { presentJson } from './results-presenter.js';

/**
 * Renders the JSON viewer page at ?view=json&id={runId}.
 *
 * Reads the test result from localStorage history by the `id` query
 * parameter and displays it as formatted JSON inside a <pre> block.
 * Falls back to descriptive error messages when the id is missing
 * or not found in history.
 *
 * @param {string} containerId - ID of the DOM element to render into
 */
export function bootstrapJsonView(containerId) {
    const main = document.getElementById(containerId);
    if (!main) {
        return;
    }

    const TITLE = 'Test Results &mdash; JSON';
    const backLink = '<a href="/" class="btn btn-primary">\u2190 Back to detector</a>';
    let jsonText = '';

    const runId = new URLSearchParams(window.location.search).get('id');

    /** @type {string} */
    let bodyHtml;

    if (!runId) {
        bodyHtml = `<h1 id="json-heading">${TITLE}</h1>
<p>No result ID specified.</p>
<a href="/" class="btn btn-primary">\u2190 Back to detector</a>`;
    } else {
        const entry = getByRunId(runId);

        if (!entry) {
            bodyHtml = `<h1 id="json-heading">${TITLE}</h1>
<p>No test result found for this ID.</p>
${backLink}`;
        } else if (entry.stripped) {
            // Entry was trimmed to fit storage — show the no-data JSON
            jsonText = presentJson(null);
            bodyHtml = `<h1 id="json-heading">${TITLE}</h1>${backLink}`;
        } else {
            // Build a TestRun-compatible object from the HistoryEntry
            jsonText = presentJson({
                runId: entry.runId,
                timestamp: entry.timestamp,
                results: entry.results,
                baselinePluginId: entry.baselinePluginId || null,
                discrepancies: entry.discrepancies || [],
                verdict: entry.verdict || {
                    level: 'no_data',
                    message: 'No data',
                    affectedServices: [],
                    indicator: 'gray',
                },
                warnings: [],
            });
            bodyHtml = `<h1 id="json-heading">${TITLE}</h1>${backLink}`;
        }
    }

    const preHtml = jsonText
        ? `<pre class="json-viewer-pre">${escapeHtml(jsonText)}</pre>`
        : '';

    main.innerHTML = `<div class="json-viewer">${bodyHtml}${preHtml}</div>`;
}

export default bootstrapJsonView;
