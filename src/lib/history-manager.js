/**
 * History Manager — persists test runs to localStorage.
 *
 * @module lib/history-manager
 */

const STORAGE_KEY = 'throttle-detector-history';
const MAX_ENTRIES = 50;
const MAX_STORAGE_BYTES = 4 * 1024 * 1024;

let storageOk = true;

// === Helpers (function declarations hoist) ===

/** @returns {boolean} */
function checkStorage() {
    try {
        const k = '__td_test__';
        localStorage.setItem(k, k);
        localStorage.removeItem(k);
        return true;
    } catch {
        return false;
    }
}

/** @returns {import('./types.js').HistoryEntry[]} */
function loadFromStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** @param {import('./types.js').TestRun} run @returns {string} */
function buildSummary(run) {
    if (!run.verdict) {
        return `${run.results.length} tests completed`;
    }
    const { verdict } = run;
    if (verdict.level === 'no_throttling') {
        return 'No throttling detected';
    }
    if (verdict.level === 'possible_throttling'
        || verdict.level === 'strong_signal') {
        const count = verdict.affectedServices.length;
        if (count === 0) {
            return verdict.message;
        }
        const svc = verdict.affectedServices.join(', ');
        return `${count} service${count !== 1 ? 's' : ''} flagged: ${svc}`;
    }
    if (verdict.level === 'inconclusive') {
        return 'Results inconclusive';
    }
    return 'No data';
}

storageOk = checkStorage();

/** @param {import('./types.js').HistoryEntry[]} history @returns {string} */
function pruneToFit(history) {
    const pruned = [...history];
    while (pruned.length > 1
        && JSON.stringify(pruned).length > MAX_STORAGE_BYTES) {
        pruned.pop();
    }
    if (JSON.stringify(pruned).length <= MAX_STORAGE_BYTES) {
        return JSON.stringify(pruned);
    }
    // Single entry still too large — strip results data, keep only metadata
    const slim = pruned.slice(0, 1).map((entry) => {
        const copy = { ...entry };
        delete copy.results;
        return copy;
    });
    return JSON.stringify(slim);
}

// === Exports ===

/** @param {import('./types.js').TestRun} run @returns {boolean} */
export function save(run) {
    if (!storageOk) {
        return false;
    }
    const entry = {
        runId: run.runId, timestamp: run.timestamp,
        pluginCount: run.results.length,
        successCount: run.results.filter((res) => res.status === 'success').length,
        errorCount: run.results.filter((res) => res.status !== 'success').length,
        summary: buildSummary(run), verdict: run.verdict, results: run.results,
    };
    try {
        const history = loadFromStorage();
        history.unshift(entry);
        while (history.length > MAX_ENTRIES) {
            history.pop();
        }
        const serialized = pruneToFit(history);
        localStorage.setItem(STORAGE_KEY, serialized);
        return true;
    } catch {
        storageOk = false;
        return false;
    }
}

/** @returns {import('./types.js').HistoryEntry[]} */
export function loadAll() {
    if (!storageOk) {
        return [];
    }
    try {
        return loadFromStorage();
    } catch {
        storageOk = false; return [];
    }
}

/** @param {string} runId @returns {import('./types.js').HistoryEntry|undefined} */
export function getByRunId(runId) {
    return loadAll().find((entry) => entry.runId === runId);
}

export function clear() {
    if (!storageOk) {
        return;
    }
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        storageOk = false;
    }
}

/** @returns {boolean} */
export function isAvailable() {
    return storageOk;
}
