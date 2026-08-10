# Data Model: ISP Throttle Detector

**Feature**: ISP Throttle Detector | **Date**: 2026-08-10

All interfaces are defined in JSDoc format since the project uses vanilla JavaScript. These are the canonical type definitions that all modules must conform to.

## Entity Definitions

### TestConfig

Configuration passed to each plugin at execution time. The test runner constructs this once per run and passes it to every plugin.

```js
/**
 * @typedef {Object} TestConfig
 * @property {number} timeoutMs - Maximum time (ms) a single plugin may run.
 *         Default: 30000 (30s). After this, the AbortController aborts.
 * @property {number} sampleDurationMs - Duration (ms) each test runs its sampling phase.
 *         Default: 10000 (10s). The plugin repeatedly downloads chunks of increasing
 *         size until this duration elapses, then calculates average speed from all
 *         samples. Auto-scales: slow connections use less data, fast connections get
 *         more accurate measurements.
 * @property {boolean} adaptivePayload - Whether to use adaptive payload sizing.
 *         Default: true. When false, uses fixed-size chunk downloads.
 */
```

### TestPlugin

The interface every test module must implement. Plugins are stateless — the test runner manages lifecycle.

```js
/**
 * @typedef {Object} TestPlugin
 * @property {string} id - Unique identifier (e.g., 'fast-com', 'cloudflare').
 *         Must be kebab-case, unique across all registered plugins.
 * @property {string} name - Human-readable display name.
 *         (e.g., 'Fast.com (Netflix)')
 * @property {string} description - One-line description of what this test measures.
 *         (e.g., 'Download speed from Netflix Open Connect CDN')
 * @property {'streaming'|'cdn'|'manufactured'} category - Test category for grouping.
 *         'streaming': Tests against streaming service infrastructure (Netflix, etc.)
 *         'cdn': Tests against general-purpose CDN infrastructure
 *         'manufactured': Tests using known-large file downloads from specific origins
 * @property {function(TestConfig): Promise<TestResult>} run - Execute the speed test.
 *         Receives TestConfig. Returns a TestResult. Must handle all errors internally
 *         (returns TestResult with status:'error', never throws).
 *         The function is serialized and sent to a Web Worker — must not capture
 *         closures over module-level state.
 */
```

### TestResult

Standardized output returned by every plugin's `run()` method. This is the primary data unit flowing through the system.

```js
/**
 * @typedef {Object} TestResult
 * @property {string} targetName - Display name of the test target.
 *         (e.g., 'Fast.com (Netflix)')
 * @property {string} pluginId - Plugin identifier matching TestPlugin.id.
 *         (e.g., 'fast-com')
 * @property {'success'|'error'|'timeout'} status - Outcome of the test.
 *         'success': Speed measurement obtained.
 *         'error': Test could not complete (CORS, network, etc.).
 *         'timeout': Test exceeded timeoutMs.
 * @property {number|null} downloadSpeedMbps - Measured download speed in Mbps.
 *         Null if status is not 'success'.
 *         Range: 0 to 10000 (practical maximum for consumer connections).
 * @property {number} durationMs - Total test duration in milliseconds.
 *         Includes all probe/scale phases. Measured via performance.now().
 * @property {number} bytesTransferred - Total bytes downloaded during the test.
 *         Used for data usage tracking. 0 if no data transferred.
 * @property {string|null} errorMessage - Human-readable error description.
 *         Null if status is 'success'. Examples:
 *         "CORS restricted — could not measure this target"
 *         "Timed out after 30 seconds"
 *         "Could not reach fast.com API — token extraction failed"
 * @property {string} timestamp - ISO 8601 timestamp of when the test completed.
 *         Format: "2026-08-10T14:30:00.000Z"
 */
```

### TestRun

A complete test execution containing results from all plugins and computed analysis.

```js
/**
 * @typedef {Object} TestRun
 * @property {string} runId - Unique identifier for this run.
 *         Format: "run-{timestamp}" (e.g., "run-20260810T143000Z").
 * @property {string} timestamp - ISO 8601 timestamp of run start.
 * @property {TestResult[]} results - Array of results from all executed plugins.
 * @property {string|null} baselinePluginId - ID of the plugin used as baseline.
 *         Null if no baseline could be established (all tests failed).
 * @property {Discrepancy[]} discrepancies - Computed discrepancies for each
 *         non-baseline result. Empty if no baseline.
 * @property {Verdict} verdict - Computed overall throttling verdict.
 * @property {string[]} warnings - Non-fatal warnings from this run.
 *         (e.g., "Some tests used fallback measurement methods")
 */
```

### Discrepancy

Computed analysis comparing a target's speed to the baseline.

```js
/**
 * @typedef {Object} Discrepancy
 * @property {string} targetName - Name of the target being compared.
 * @property {string} pluginId - Plugin ID of the target.
 * @property {number|null} percentageDeviation - How much the target deviates from
 *         baseline. Positive = target is FASTer than baseline.
 *         Negative = target is SLOWer than baseline.
 *         Null if baseline or target speed is 0.
 *         Formula: ((targetSpeed - baselineSpeed) / baselineSpeed) * 100
 * @property {'slower'|'faster'|'equal'|'unknown'} direction -
 *         'slower': target speed < baseline speed (potential throttling)
 *         'faster': target speed > baseline speed
 *         'equal': within 1% of baseline
 *         'unknown': cannot compute (missing data)
 * @property {boolean} isSignificant - Whether the deviation exceeds the
 *         significance threshold (currently 15%).
 * @property {'normal'|'possible_throttling'|'strong_signal'|'inconclusive'}
 *         classification - Throttling classification:
 *         'normal': |deviation| ≤ 15%
 *         'possible_throttling': 15% < |deviation| ≤ 30% AND target is slower
 *         'strong_signal': |deviation| > 30% AND target is slower
 *         'inconclusive': cannot determine (missing data, faster than baseline)
 */
```

### Verdict

Overall throttling assessment for a TestRun.

```js
/**
 * @typedef {Object} Verdict
 * @property {'no_throttling'|'possible_throttling'|'strong_signal'|'inconclusive'|'no_data'}
 *         level - Overall throttling level:
 *         'no_throttling': All targets within 15% of baseline
 *         'possible_throttling': At least one target 15-30% slower than baseline
 *         'strong_signal': At least one target >30% slower than baseline
 *         'inconclusive': Tests completed but cannot determine
 *         (e.g., baseline failed, all targets faster than baseline)
 *         'no_data': No test has been run
 * @property {string} message - Plain-language verdict message.
 *         Format varies by level:
 *         'no_throttling': "No throttling detected"
 *         'possible_throttling': "Possible throttling on Fast.com (Netflix)"
 *         'strong_signal': "Strong throttling signal for Fast.com (Netflix)"
 *         'inconclusive': "Unable to determine — baseline test did not complete"
 *         'no_data': "No tests have been run yet"
 * @property {string[]} affectedServices - Service names flagged for throttling.
 *         Empty if no throttling detected or inconclusive.
 * @property {'green'|'yellow'|'red'|'gray'} indicator - Visual indicator color.
 */
```

### HistoryEntry

A serialized TestRun as stored in localStorage. The wrapper adds metadata for list display and eviction.

```js
/**
 * @typedef {Object} HistoryEntry
 * @property {string} runId - Matches TestRun.runId. Used as localStorage key part.
 * @property {string} timestamp - ISO 8601 timestamp for display.
 * @property {number} pluginCount - Number of plugins that ran.
 * @property {number} successCount - Number of successful measurements.
 * @property {number} errorCount - Number of failed/errored measurements.
 * @property {string} summary - One-line summary for history list display.
 *         (e.g., "2 of 4 targets show throttling signals")
 * @property {Verdict} verdict - Cached verdict for quick list display.
 * @property {TestResult[]} results - Full results array for detail view.
 */
```

## Validation Rules

### TestResult validation

```
- targetName: non-empty string
- pluginId: non-empty string, must match a registered plugin ID
- status: must be 'success' | 'error' | 'timeout'
- downloadSpeedMbps: must be >= 0 if status is 'success', must be null otherwise
- durationMs: must be >= 0
- bytesTransferred: must be >= 0
- errorMessage: must be null if status is 'success', non-empty string otherwise
- timestamp: must be valid ISO 8601 string
```

### Discrepancy validation

```
- percentageDeviation: must be a number if both speeds are > 0, null otherwise
- direction: 'faster' when > 1% above baseline, 'slower' when > 1% below,
            'equal' when within 1%, 'unknown' when cannot compute
- classification: derived from direction + |percentageDeviation|
  - 'normal': |deviation| ≤ 15% regardless of direction
  - 'possible_throttling': 15% < |deviation| ≤ 30% AND direction is 'slower'
  - 'strong_signal': |deviation| > 30% AND direction is 'slower'
  - 'inconclusive' if any required data is missing
```

## State Transitions

### UI State Machine

```
                  ┌─────────┐
     page load →  │ initial │
                  └────┬────┘
                       │ click "Run Test"
                  ┌────▼────┐
                  │ running │ ←── "Run Test" button disabled
                  └────┬────┘
                       │
              ┌────────┼─────────┐
              │        │         │
         all tests  partial    all tests
         succeed    failures   fail
              │        │         │
         ┌────▼──┐ ┌──▼──────┐ ┌─▼────────┐
         │complete│ │complete │ │error-full│
         │        │ │(w/errors│ │          │
         └────────┘ └─────────┘ └──────────┘
              │        │         │
              └────────┼─────────┘
                       │ "Run Test" again
                  ┌────▼────┐
                  │ running │  (cycle repeats)
                  └─────────┘
```

### TestRun Lifecycle

```
created → [plugins execute] → results collected → [analyze] →
discrepancies computed → verdict generated → [persist to localStorage] →
presented to user
```

Any plugin failure at any stage does not prevent other plugins from completing. The lifecycle continues with partial results.

## Storage Schema

```
localStorage key: "throttle-detector-history"

Value: JSON array of HistoryEntry objects, newest first.

Example:
[
  {
    "runId": "run-20260810T143000Z",
    "timestamp": "2026-08-10T14:30:00.000Z",
    "pluginCount": 4,
    "successCount": 3,
    "errorCount": 1,
    "summary": "1 of 4 targets show throttling signals",
    "verdict": { ... },
    "results": [ ... ]
  },
  { ... }
]

Maximum entries: configurable, default 50.
Eviction policy: Remove oldest entries (end of array) when approaching
localStorage quota (~5MB). Evict one at a time until serialized size < 4MB.
```

### Storage Estimation

Each HistoryEntry with 4 TestResults ≈ 2-3KB serialized JSON. 50 entries ≈ 100-150KB. Well within localStorage's ~5MB limit.
