/**
 * JSDoc type definitions for the ISP Throttle Detector.
 *
 * These are documentation-only typedefs. They do not export runtime values.
 * Import this module for type hints in JSDoc comments.
 *
 * @module lib/types
 */

/**
 * Configuration passed to each plugin at execution time.
 *
 * @typedef {Object} TestConfig
 * @property {number} timeoutMs - Maximum time (ms) a single plugin may run.
 *           Default: 30000 (30s).
 * @property {number} sampleDurationMs - Duration (ms) each test runs its
 *           time-bounded sampling phase. Default: 10000 (10s).
 * @property {boolean} adaptivePayload - Whether to use adaptive chunk sizing.
 *           Default: true.
 */

/**
 * The interface every test module must implement.
 *
 * @typedef {Object} TestPlugin
 * @property {string} id - Unique identifier (kebab-case).
 * @property {string} name - Human-readable display name.
 * @property {string} description - One-line description.
 * @property {'streaming'|'cdn'|'manufactured'} category - Test category.
 * @property {function(TestConfig): Promise<TestResult>} run - Execute the test.
 */

/**
 * Standardized output returned by every plugin's run() method.
 *
 * @typedef {Object} TestResult
 * @property {string} targetName - Display name of the test target.
 * @property {string} pluginId - Plugin identifier.
 * @property {'success'|'error'|'timeout'} status - Outcome.
 * @property {number|null} downloadSpeedMbps - Speed in Mbps, null on error.
 * @property {number} durationMs - Total test duration in ms.
 * @property {number} bytesTransferred - Total bytes downloaded.
 * @property {string|null} errorMessage - Error description, null on success.
 * @property {string} timestamp - ISO 8601 timestamp.
 */

/**
 * A complete test execution with results and analysis.
 *
 * @typedef {Object} TestRun
 * @property {string} runId - Unique identifier.
 * @property {string} timestamp - ISO 8601 run start timestamp.
 * @property {TestResult[]} results - Results from all executed plugins.
 * @property {string|null} baselinePluginId - ID of the baseline plugin.
 * @property {Discrepancy[]} discrepancies - Computed discrepancies.
 * @property {Verdict} verdict - Overall throttling verdict.
 * @property {string[]} warnings - Non-fatal warnings.
 */

/**
 * Computed analysis comparing a target's speed to the baseline.
 *
 * @typedef {Object} Discrepancy
 * @property {string} targetName - Name of the target.
 * @property {string} pluginId - Plugin ID.
 * @property {number|null} percentageDeviation - Deviation from baseline (%).
 * @property {'slower'|'faster'|'equal'|'unknown'} direction - Direction.
 * @property {boolean} isSignificant - Whether deviation is significant.
 * @property {'normal'|'possible_throttling'|'strong_signal'|'inconclusive'}
 *           classification - Throttling classification.
 */

/**
 * Overall throttling assessment.
 *
 * @typedef {Object} Verdict
 * @property {'no_throttling'|'possible_throttling'|'strong_signal'|
 *            'inconclusive'|'no_data'} level - Overall level.
 * @property {string} message - Plain-language message.
 * @property {string[]} affectedServices - Services flagged.
 * @property {'green'|'yellow'|'red'|'gray'} indicator - Visual indicator.
 */

/**
 * A serialized test run for localStorage.
 *
 * @typedef {Object} HistoryEntry
 * @property {string} runId - Matches TestRun.runId.
 * @property {string} timestamp - ISO 8601 timestamp.
 * @property {number} pluginCount - Number of plugins.
 * @property {number} successCount - Successful measurements.
 * @property {number} errorCount - Failed measurements.
 * @property {string} summary - One-line summary.
 * @property {Verdict} verdict - Cached verdict.
 * @property {TestResult[]} results - Full results.
 */

export {};
