/**
 * Results Analyzer — computes discrepancies and generates verdicts.
 *
 * Takes raw TestResult[] from the runner, selects a baseline, calculates
 * percentage deviations for each target, and classifies results per the
 * throttling thresholds defined in the spec.
 *
 * @module lib/results-analyzer
 */

/** Percentage threshold for normal range (≤ this value) */
const NORMAL_THRESHOLD = 15;

/** Percentage threshold for strong signal (> this value) */
const STRONG_THRESHOLD = 30;

/** Margin within which speeds are considered equal */
const EQUAL_MARGIN = 1;

/**
 * Analyzes a set of test results and returns baseline, discrepancies, and verdict.
 *
 * @param {import('./types.js').TestResult[]} results - Raw plugin results
 * @returns {{
 *   baseline: import('./types.js').TestResult|null,
 *   discrepancies: import('./types.js').Discrepancy[],
 *   verdict: import('./types.js').Verdict
 * }}
 */
export function analyzeResults(results) {
    if (!results || results.length === 0) {
        return {
            baseline: null,
            discrepancies: [],
            verdict: {
                level: 'no_data',
                message: 'No tests have been run yet',
                affectedServices: [],
                indicator: 'gray',
            },
        };
    }

    const successful = results.filter((r) => r.status === 'success' && r.downloadSpeedMbps !== null);

    if (successful.length === 0) {
        return {
            baseline: null,
            discrepancies: results.map((r) => ({
                targetName: r.targetName,
                pluginId: r.pluginId,
                percentageDeviation: null,
                direction: 'unknown',
                isSignificant: false,
                classification: 'inconclusive',
            })),
            verdict: {
                level: 'inconclusive',
                message: 'Unable to determine \u2014 tests could not complete',
                affectedServices: [],
                indicator: 'gray',
            },
        };
    }

    // Baseline: prefer Cloudflare, then fastest successful result
    const baseline = selectBaseline(successful);
    const baselineSpeed = baseline.downloadSpeedMbps;

    // Compute discrepancies for all successful results (excluding baseline)
    const discrepancies = [];
    for (const result of successful) {
        if (result.pluginId === baseline.pluginId) {
            continue;
        }

        const discrepancy = computeDiscrepancy(result, baselineSpeed);
        discrepancies.push(discrepancy);
    }

    // Add inconclusive entries for failed tests
    for (const result of results) {
        if (result.status !== 'success' || result.downloadSpeedMbps === null) {
            if (result.pluginId === baseline.pluginId) {
                continue;
            }
            discrepancies.push({
                targetName: result.targetName,
                pluginId: result.pluginId,
                percentageDeviation: null,
                direction: 'unknown',
                isSignificant: false,
                classification: 'inconclusive',
            });
        }
    }

    const verdict = generateVerdict(discrepancies, results);

    return { baseline, discrepancies, verdict };
}

/**
 * Selects the baseline from successful results.
 * Prefers 'cloudflare' plugin, then picks the fastest result.
 *
 * @param {import('./types.js').TestResult[]} successful - Successful results
 * @returns {import('./types.js').TestResult}
 */
function selectBaseline(successful) {
    // Prefer Cloudflare
    const cloudflare = successful.find((r) => r.pluginId === 'cloudflare');
    if (cloudflare) {
        return cloudflare;
    }
    // Otherwise, pick the fastest
    return successful.reduce((fastest, current) =>
        (current.downloadSpeedMbps || 0) > (fastest.downloadSpeedMbps || 0) ? current : fastest);
}

/**
 * Computes the discrepancy between a target result and the baseline speed.
 *
 * @param {import('./types.js').TestResult} target - Target result
 * @param {number} baselineSpeed - Baseline speed in Mbps
 * @returns {import('./types.js').Discrepancy}
 */
function computeDiscrepancy(target, baselineSpeed) {
    const targetSpeed = target.downloadSpeedMbps;
    if (targetSpeed === null || baselineSpeed === 0 || targetSpeed === 0) {
        return {
            targetName: target.targetName,
            pluginId: target.pluginId,
            percentageDeviation: null,
            direction: 'unknown',
            isSignificant: false,
            classification: 'inconclusive',
        };
    }

    const deviation = ((targetSpeed - baselineSpeed) / baselineSpeed) * 100;
    const absDeviation = Math.abs(deviation);

    let direction;
    if (absDeviation <= EQUAL_MARGIN) {
        direction = 'equal';
    } else if (deviation < 0) {
        direction = 'slower';
    } else {
        direction = 'faster';
    }

    let classification;
    if (absDeviation <= NORMAL_THRESHOLD) {
        classification = 'normal';
    } else if (direction === 'slower') {
        if (absDeviation > STRONG_THRESHOLD) {
            classification = 'strong_signal';
        } else {
            classification = 'possible_throttling';
        }
    } else {
        classification = 'inconclusive';
    }

    return {
        targetName: target.targetName,
        pluginId: target.pluginId,
        percentageDeviation: Math.round(deviation * 10) / 10,
        direction,
        isSignificant: absDeviation > NORMAL_THRESHOLD,
        classification,
    };
}

/**
 * Generates an overall verdict from computed discrepancies.
 *
 * @param {import('./types.js').Discrepancy[]} discrepancies
 * @param {import('./types.js').TestResult[]} results - All results for context
 * @returns {import('./types.js').Verdict}
 */
function generateVerdict(discrepancies, results) {
    const successful = results.filter((r) => r.status === 'success' && r.downloadSpeedMbps !== null);

    if (successful.length === 0) {
        return {
            level: 'inconclusive',
            message: 'Unable to determine \u2014 tests could not complete',
            affectedServices: [],
            indicator: 'gray',
        };
    }

    const strongSignals = discrepancies.filter((d) => d.classification === 'strong_signal');
    const possibleThrottling = discrepancies.filter((d) => d.classification === 'possible_throttling');

    if (strongSignals.length > 0) {
        const serviceNames = strongSignals.map((d) => d.targetName).join(', ');
        return {
            level: 'strong_signal',
            message: `Strong throttling signal for ${serviceNames}`,
            affectedServices: strongSignals.map((d) => d.targetName),
            indicator: 'red',
        };
    }

    if (possibleThrottling.length > 0) {
        const serviceNames = possibleThrottling.map((d) => d.targetName).join(', ');
        return {
            level: 'possible_throttling',
            message: `Possible throttling on ${serviceNames}`,
            affectedServices: possibleThrottling.map((d) => d.targetName),
            indicator: 'yellow',
        };
    }

    return {
        level: 'no_throttling',
        message: 'No throttling detected',
        affectedServices: [],
        indicator: 'green',
    };
}
