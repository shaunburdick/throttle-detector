/**
 * History Manager — persists test runs to localStorage and manages eviction.
 *
 * Handles save, load, lookup, and quota-aware eviction of test history.
 * Falls back to in-memory-only mode when localStorage is unavailable.
 *
 * @module lib/history-manager
 */

const STORAGE_KEY = 'throttle-detector-history';
const MAX_ENTRIES = 50;
const MAX_STORAGE_BYTES = 4 * 1024 * 1024; // 4MB soft cap

/** @type {boolean} Whether localStorage is available */
let storageAvailable = true;

/**
 * Checks if localStorage is writable.
 *
 * @returns {boolean}
 */
function isStorageWritable() {
    try {
        const testKey = '__td_test__';
        localStorage.setItem(testKey, testKey);
        localStorage.removeItem(testKey);
        return true;
    } catch {
        return false;
    }
}

// Check at module load
storageAvailable = isStorageWritable();

/**
 * Saves a test run to localStorage.
 *
 * @param {import('./types.js').TestRun} run - The completed test run
 * @returns {boolean} Whether the save succeeded
 */
export function save(run) {
    if (!storageAvailable) {
        return false;
    }

    const entry = {
        runId: run.runId,
        timestamp: run.timestamp,
        pluginCount: run.results.length,
        successCount: run.results.filter((r) => r.status === 'success').length,
        errorCount: run.results.filter((r) => r.status !== 'success').length,
        summary: buildSummary(run),
        verdict: run.verdict,
        results: run.results,
    };

    try {
        const history = loadFromStorage();
        // Newest first
        history.unshift(entry);

        // Enforce max entries limit
        while (history.length > MAX_ENTRIES) {
            history.pop();
        }

        // Enforce storage size limit
        const serialized = JSON.stringify(history);
        if (serialized.length > MAX_STORAGE_BYTES) {
            // Evict oldest until under limit
            while (history.length > 1) {
                history.pop();
                const reduced = JSON.stringify(history);
                if (reduced.length <= MAX_STORAGE_BYTES) {
                    break;
                }
            }
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        return true;
    } catch {
        storageAvailable = false;
        return false;
    }
}

/**
 * Loads all history entries from localStorage.
 *
 * @returns {import('./types.js').HistoryEntry[]} Newest first
 */
export function loadAll() {
    if (!storageAvailable) {
        return [];
    }

    try {
        return loadFromStorage();
    } catch {
        storageAvailable = false;
        return [];
    }
}

/**
 * Gets a specific history entry by run ID.
 *
 * @param {string} runId
 * @returns {import('./types.js').HistoryEntry|undefined}
 */
export function getByRunId(runId) {
    const entries = loadAll();
    return entries.find((e) => e.runId === runId);
}

/**
 * Clears all history from localStorage.
 */
export function clear() {
    if (!storageAvailable) {
        return;
    }
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        storageAvailable = false;
    }
}

/**
 * Checks if localStorage is available for persistence.
 *
 * @returns {boolean}
 */
export function isAvailable() {
    return storageAvailable;
}

/**
 * Loads and parses history from localStorage.
 *
 * @returns {import('./types.js').HistoryEntry[]}
 */
function loadFromStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed;
    } catch {
        return [];
    }
}

/**
 * Builds a one-line summary for the history list.
 *
 * @param {import('./types.js').TestRun} run
 * @returns {string}
 */
function buildSummary(run) {
    if (!run.verdict) {
        return `${run.results.length} tests completed`;
    }

    switch (run.verdict.level) {
        case 'no_throttling':
            return 'No throttling detected';
        case 'possible_throttling':
        case 'strong_signal': {
            const count = run.verdict.affectedServices.length;
            const services = run.verdict.affectedServices.join(', ');
            if (count === 0) {
                return run.verdict.message;
            }
            return `${count} service${count !== 1 ? 's' : ''} flagged: ${services}`;
        }
        case 'inconclusive':
            return 'Results inconclusive';
        case 'no_data':
        default:
            return 'No data';
    }
}
