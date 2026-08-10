/**
 * Results Analyzer — computes discrepancies and generates verdicts.
 *
 * @module lib/results-analyzer
 */

const NORMAL_THRESHOLD = 15;
const STRONG_THRESHOLD = 30;
const EQUAL_MARGIN = 1;

// === Helpers (function declarations hoist) ===

/**
 * @param {import('./types.js').TestResult[]} successful
 * @returns {import('./types.js').TestResult}
 */
function selectBaseline(successful) {
    const cf = successful.find((res) => res.pluginId === 'cloudflare');
    if (cf) {
        return cf;
    }
    return successful.reduce((fast, cur) =>
        (cur.downloadSpeedMbps || 0) > (fast.downloadSpeedMbps || 0) ? cur : fast);
}

/**
 * @param {import('./types.js').TestResult} target
 * @param {number} baselineSpeed
 * @returns {import('./types.js').Discrepancy}
 */
function computeDiscrepancy(target, baselineSpeed) {
    const targetSpeed = target.downloadSpeedMbps;
    if (targetSpeed === null || baselineSpeed === 0 || targetSpeed === 0) {
        return makeDisc(target, null, 'unknown', false, 'inconclusive');
    }
    const dev = ((targetSpeed - baselineSpeed) / baselineSpeed) * 100;
    const absDev = Math.abs(dev);
    const dir = absDev <= EQUAL_MARGIN ? 'equal' : dev < 0 ? 'slower' : 'faster';
    const cls = absDev <= NORMAL_THRESHOLD ? 'normal'
        : dir === 'slower' ? (absDev > STRONG_THRESHOLD ? 'strong_signal' : 'possible_throttling')
            : 'inconclusive';
    return makeDisc(target, Math.round(dev * 10) / 10, dir, absDev > NORMAL_THRESHOLD, cls);
}

/**
 * @param {import('./types.js').TestResult} target
 * @param {number|null} dev
 * @param {string} dir
 * @param {boolean} sig
 * @param {string} cls
 * @returns {import('./types.js').Discrepancy}
 */
function makeDisc(target, dev, dir, sig, cls) {
    return {
        targetName: target.targetName, pluginId: target.pluginId,
        percentageDeviation: dev, direction: dir,
        isSignificant: sig, classification: cls,
    };
}

/**
 * @param {import('./types.js').Discrepancy[]} discList
 * @param {import('./types.js').TestResult[]} results
 * @returns {import('./types.js').Verdict}
 */
function generateVerdict(discList, results) {
    const ok = results.filter(
        (res) => res.status === 'success' && res.downloadSpeedMbps !== null
    );
    if (ok.length === 0) {
        return {
            level: 'inconclusive',
            message: 'Unable to determine \u2014 tests could not complete',
            affectedServices: [], indicator: 'gray',
        };
    }
    const strong = discList.filter((d) => d.classification === 'strong_signal');
    const possible = discList.filter((d) => d.classification === 'possible_throttling');

    if (strong.length > 0) {
        return {
            level: 'strong_signal',
            message: `Strong throttling signal for ${strong.map((d) => d.targetName).join(', ')}`,
            affectedServices: strong.map((d) => d.targetName),
            indicator: 'red',
        };
    }
    if (possible.length > 0) {
        return {
            level: 'possible_throttling',
            message: `Possible throttling on ${possible.map((d) => d.targetName).join(', ')}`,
            affectedServices: possible.map((d) => d.targetName),
            indicator: 'yellow',
        };
    }
    return {
        level: 'no_throttling', message: 'No throttling detected',
        affectedServices: [], indicator: 'green',
    };
}

// === Main export ===

/**
 * Analyzes test results.
 *
 * @param {import('./types.js').TestResult[]} results
 * @returns {{
 *   baseline: import('./types.js').TestResult|null,
 *   discrepancies: import('./types.js').Discrepancy[],
 *   verdict: import('./types.js').Verdict
 * }}
 */
export function analyzeResults(results) {
    if (!results || results.length === 0) {
        return { baseline: null, discrepancies: [], verdict: noDataVerdict() };
    }
    const successful = results.filter(
        (res) => res.status === 'success' && res.downloadSpeedMbps !== null
    );
    if (successful.length === 0) {
        const discList = results.map((res) => makeDisc(res, null, 'unknown', false, 'inconclusive'));
        return {
            baseline: null, discrepancies: discList,
            verdict: {
                level: 'inconclusive',
                message: 'Unable to determine \u2014 tests could not complete',
                affectedServices: [], indicator: 'gray',
            },
        };
    }
    const baseline = selectBaseline(successful);
    const bs = baseline.downloadSpeedMbps;
    const discList = [];

    for (const res of successful) {
        if (res.pluginId === baseline.pluginId) {
            continue;
        }
        discList.push(computeDiscrepancy(res, bs));
    }
    for (const res of results) {
        if (res.status === 'success' && res.downloadSpeedMbps !== null) {
            continue;
        }
        if (res.pluginId === baseline.pluginId) {
            continue;
        }
        discList.push(makeDisc(res, null, 'unknown', false, 'inconclusive'));
    }
    return { baseline, discrepancies: discList, verdict: generateVerdict(discList, results) };
}

/** @returns {import('./types.js').Verdict} */
function noDataVerdict() {
    return {
        level: 'no_data', message: 'No tests have been run yet',
        affectedServices: [], indicator: 'gray',
    };
}
