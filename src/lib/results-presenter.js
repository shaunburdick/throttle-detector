/**
 * Results Presenter — dual-mode output for HTML dashboard and JSON.
 *
 * @module lib/results-presenter
 */

import { formatMbps, formatDuration } from './utils.js';

const KIB = 1024;
const MIB = 1024 * 1024;

// === HTML helpers (function declarations hoist) ===

/** @param {string} str @returns {string} */
function escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/** @param {number} bytes @returns {string} */
function formatBytes(bytes) {
    if (bytes < KIB) {
        return `${bytes} B`;
    }
    if (bytes < MIB) {
        return `${(bytes / KIB).toFixed(1)} KB`;
    }
    return `${(bytes / MIB).toFixed(1)} MB`;
}

/**
 * @param {import('./types.js').Discrepancy|undefined} disc
 * @param {string} status
 * @returns {string}
 */
function getRowClass(disc, status) {
    if (status !== 'success') {
        return 'row-inconclusive';
    }
    if (!disc) {
        return '';
    }
    const mapRow = {
        normal: 'row-normal',
        possible_throttling: 'row-possible',
        strong_signal: 'row-strong',
    };
    return mapRow[disc.classification] || 'row-inconclusive';
}

/**
 * @param {import('./types.js').Discrepancy|undefined} disc
 * @param {string} status
 * @returns {string}
 */
function getBadgeClass(disc, status) {
    if (status !== 'success') {
        return 'badge-error';
    }
    if (!disc) {
        return 'badge-neutral';
    }
    const mapBadge = {
        normal: 'badge-success',
        possible_throttling: 'badge-warning',
        strong_signal: 'badge-danger',
    };
    return mapBadge[disc.classification] || 'badge-neutral';
}

/**
 * @param {import('./types.js').TestResult} result
 * @param {boolean} isBaseline
 * @param {import('./types.js').Discrepancy|undefined} disc
 * @returns {string}
 */
function getStatusBadge(result, isBaseline, disc) {
    if (isBaseline) {
        return 'Baseline';
    }
    if (result.status === 'error') {
        return 'Error';
    }
    if (result.status === 'timeout') {
        return 'Timeout';
    }
    if (!disc) {
        return 'Unknown';
    }
    const mapStatus = {
        normal: 'Normal',
        possible_throttling: 'Possible Throttling',
        strong_signal: 'Strong Throttling Signal',
    };
    return mapStatus[disc.classification] || 'Inconclusive';
}

/** @param {import('./types.js').Verdict} verdict @returns {string} */
function getVerdictExplanation(verdict) {
    const EXPLANATIONS = {
        no_throttling: 'All tested services show speeds within 15% of the baseline. '
            + 'Your ISP does not appear to be throttling any of the tested services.',
        possible_throttling: 'One or more services are 15-30% slower than the baseline. '
            + 'This could indicate throttling, but network conditions may also be a factor. '
            + 'Try running the test at a different time to confirm.',
        strong_signal: 'One or more services are more than 30% slower than the baseline. '
            + 'This is a strong indicator that your ISP may be throttling these specific services. '
            + 'Consider contacting your ISP or using a VPN to bypass throttling.',
        inconclusive: 'Not enough successful measurements are available to determine throttling. '
            + 'Some tests may have failed due to network restrictions. Check the individual results for details.',
    };
    return EXPLANATIONS[verdict.level] || 'Run a test to see results.';
}

// === Table / card builders ===

/**
 * @param {import('./types.js').TestRun} run
 * @returns {string}
 */
function buildTable(run) {
    const { results, baselinePluginId, discrepancies } = run;
    let rows = '';

    for (const result of results) {
        const isBaseline = result.pluginId === baselinePluginId;
        const disc = discrepancies.find((d) => d.pluginId === result.pluginId);
        const speed = result.status === 'success'
            ? formatMbps(result.downloadSpeedMbps) : '';
        const deviation = disc && disc.percentageDeviation !== null
            ? `${(disc.percentageDeviation > 0 ? '+' : '')
              + disc.percentageDeviation.toFixed(1)  }%`
            : '\u2014';
        const badge = getStatusBadge(result, isBaseline, disc);
        const badgeCls = isBaseline ? 'badge-neutral' : getBadgeClass(disc, result.status);

        rows += `<tr class="${getRowClass(disc, result.status)}">
            <td>${escape(result.targetName)}</td>
            <td>${speed || '\u2014'}</td>
            <td>${formatDuration(result.durationMs)}</td>
            <td>${result.bytesTransferred > 0 ? formatBytes(result.bytesTransferred) : '\u2014'}</td>
            <td aria-label="${deviation}">${deviation}</td>
            <td><span class="badge ${badgeCls}">${badge}</span></td>
            ${result.errorMessage ? `<td>${escape(result.errorMessage)}</td>` : '<td>\u2014</td>'}
        </tr>`;
    }

    return `<section class="results-section" aria-labelledby="results-heading">
        <table class="results-table" aria-label="Speed test results comparison">
            <caption id="results-heading">Speed Test Results</caption>
            <thead><tr>
                <th scope="col">Target</th><th scope="col">Speed</th>
                <th scope="col">Duration</th><th scope="col">Data Used</th>
                <th scope="col">Deviation</th><th scope="col">Status</th>
                <th scope="col">Details</th>
            </tr></thead>
            <tbody>${rows}</tbody></table></section>`;
}

/** @param {import('./types.js').Verdict} verdict @returns {string} */
function buildVerdictCard(verdict) {
    if (!verdict) {
        return '';
    }
    const ICONS = {
        green: '\u2705', yellow: '\u26A0\uFE0F',
        red: '\u274C', gray: '\u2753',
    };
    const icon = ICONS[verdict.indicator] || ICONS.gray;
    const explanation = getVerdictExplanation(verdict);

    return `<div class="verdict-card verdict-card--${verdict.indicator}" role="status" aria-live="polite">
        <span class="verdict-indicator" aria-hidden="true">${icon}</span>
        <div class="verdict-text">
            <h2>${escape(verdict.message)}</h2>
            <p>${escape(explanation)}</p>
        </div></div>`;
}

/** @param {import('./types.js').TestRun} run @returns {string} */
function buildDetails(run) {
    if (!run.warnings || run.warnings.length === 0) {
        return '';
    }
    const items = run.warnings.map((w) => `<li>${escape(w)}</li>`).join('');
    return `<details class="test-details fade-in">
        <summary>Warnings (${run.warnings.length})</summary><ul>${items}</ul></details>`;
}

// === Exports ===

/** @param {import('./types.js').TestRun} run @returns {string} */
export function presentHtml(run) {
    if (!run || run.results.length === 0) {
        return '<div class="empty-state"><p>No results to display.</p></div>';
    }
    return buildTable(run) + buildVerdictCard(run.verdict) + buildDetails(run);
}

/** @param {import('./types.js').TestRun|null} run @returns {string} */
export function presentJson(run) {
    if (!run || run.results.length === 0) {
        return JSON.stringify({
            results: [], lastTestTimestamp: null, baselineName: null,
            verdict: { level: 'no_data', message: 'No tests have been run yet' },
            errors: [],
        }, null, 2);
    }

    const errors = run.results
        .filter((result) => result.status !== 'success')
        .map((result) => ({
            targetName: result.targetName, pluginId: result.pluginId,
            status: result.status, errorMessage: result.errorMessage,
        }));

    return JSON.stringify({
        results: run.results,
        lastTestTimestamp: run.timestamp,
        baselineName: run.baselinePluginId,
        verdict: {
            level: run.verdict.level, message: run.verdict.message,
            affectedServices: run.verdict.affectedServices,
        },
        discrepancies: run.discrepancies, errors,
    }, null, 2);
}
