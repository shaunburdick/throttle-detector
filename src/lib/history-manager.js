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
    const v = run.verdict;
    if (v.level === 'no_throttling') {
        return 'No throttling detected';
    }
    if (v.level === 'possible_throttling' || v.level === 'strong_signal') {
        const count = v.affectedServices.length;
        if (count === 0) {
            return v.message;
        }
        const svc = v.affectedServices.join(', ');
        return `${count} service${count !== 1 ? 's' : ''} flagged: ${svc}`;
    }
    if (v.level === 'inconclusive') {
        return 'Results inconclusive';
    }
    return 'No data';
}

storageOk = checkStorage();

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
        const ser = JSON.stringify(history);
        if (ser.length > MAX_STORAGE_BYTES) {
            while (history.length > 1) {
                history.pop();
                if (JSON.stringify(history).length <= MAX_STORAGE_BYTES) {
                    break;
                }
            }
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        return true;
    } catch {
        storageOk = false; return false;
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
