# Feature Specification: ISP Throttle Detector

**Feature Branch**: `001-isp-throttle-detector`

**Created**: 2026-08-10

**Status**: Draft

**Input**: User description: "A client-side web application that detects ISP throttling by running differential speed tests against multiple service origins and comparing results. The key insight: ISPs often throttle specific services (Netflix, YouTube, etc.) while leaving generic speed tests untouched. A significant discrepancy between e.g. fast.com (Netflix infrastructure) and speedtest.net (Ookla) is a strong signal of Netflix throttling."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run a Differential Speed Test (Priority: P1)

A user visits the application in their browser, clicks "Run Test", and watches as the tool runs parallel speed tests against all configured targets. A progress indicator shows which tests are running and which have completed. Once all tests finish (or timeout), the user sees a results table comparing download speeds across all test targets, color-coded to highlight discrepancies that suggest throttling.

**Why this priority**: This is the core value proposition. Without this flow, the application does nothing useful.

**Independent Test**: Can be fully tested by opening the application, clicking "Run Test", and verifying that (a) all configured test targets execute, (b) each target returns a Mbps measurement or a clear error, (c) results are displayed in a comparison table. Delivers the primary user value: knowing whether their ISP throttles specific services.

**Acceptance Scenarios**:

1. **Given** the application is loaded and no test has been run, **When** the user clicks "Run Test", **Then** all configured test targets begin executing sequentially and a progress indicator shows each target's status (idle → running → complete/error).
2. **Given** all tests have completed successfully, **When** results are displayed, **Then** the user sees each target's name, measured download speed in Mbps, and whether a significant discrepancy exists relative to the baseline (generic speed test).
3. **Given** one test target fails (e.g., CORS rejection, timeout), **When** the test run completes, **Then** the failed target shows a plain-language error message instead of a speed measurement, and the other results are still displayed.
4. **Given** the user runs a differential test comparing fast.com and Speedtest.net, **When** fast.com reports 50 Mbps and Speedtest.net reports 200 Mbps, **Then** the results table highlights the fast.com row with a "throttling likely" indicator and explains that Netflix traffic may be affected.

---

### User Story 2 - View Test History & Trends (Priority: P2)

After running multiple tests over time, a user can scroll through their saved test history. Each entry shows the timestamp and a summary of the most significant discrepancy found. The user can click any entry to see the full results from that run. This lets them track whether throttling is getting better or worse.

**Why this priority**: A single test is a snapshot. Trends over time confirm persistent throttling vs. temporary congestion. This adds diagnostic confidence.

**Independent Test**: Run 2–3 tests at different times, then verify that all results appear in the history list with correct timestamps, and that clicking an entry shows the full results from that run. Delivers value even without the P3 features.

**Acceptance Scenarios**:

1. **Given** the user has run at least one test, **When** they view the history section, **Then** each past test run is listed with its timestamp and a one-line summary (e.g., "3 of 5 targets show throttling signals").
2. **Given** multiple test runs exist in history, **When** the user clicks a specific entry, **Then** the full results from that run are displayed.
3. **Given** the user closes the browser and returns later, **When** they open the application, **Then** their previous test history is still available.
4. **Given** history storage is approaching the browser's localStorage limit, **When** a new test completes, **Then** the oldest entry is evicted to make room, and the user is not shown an error.

---

### User Story 3 - Access Results as Machine-Readable JSON (Priority: P3)

A technically-inclined user or automated script appends `?format=json` to the application URL. Instead of the visual dashboard, the application returns a JSON document containing the most recent test results (or an empty results array if no test has been run). This enables scripting, monitoring dashboards, and integration with other tools.

**Why this priority**: This is a power-user and automation feature. The visual dashboard (P1/P2) must work first. JSON mode builds on the same test infrastructure.

**Independent Test**: Navigate to the application with `?format=json`, run a test (either via the UI on a different tab or by triggering a test run through the JSON mode), and verify that valid JSON is returned with the expected schema. Delivers value for scripting workflows.

**Acceptance Scenarios**:

1. **Given** the application URL includes `?format=json`, **When** a test has been run, **Then** the response is a valid JSON document containing an array of test result objects with fields: `targetName`, `status` (success/error), `downloadSpeedMbps` (number or null), `discrepancy` (object with `isSignificant`, `percentageDeviation`, `direction`), `durationMs`, and `timestamp`.
2. **Given** the application URL includes `?format=json` and no test has been run yet, **Then** the response is a valid JSON document with an empty results array and a `lastTestTimestamp: null`.
3. **Given** the JSON mode is active, **When** `?format=json` is the only URL parameter, **Then** the most recent test results from localStorage are returned without requiring a new test.

---

### User Story 4 - Understand Throttling Signals (Priority: P2)

A user who is not a network engineer looks at the results and wonders "so, is my ISP throttling me?" The results table includes a clear, plain-language verdict based on the discrepancy analysis: "No throttling detected", "Possible throttling detected on [service names]", or "Strong throttling signal for [service names]". Each verdict is accompanied by a brief explanation of what the numbers mean and what the user can do about it.

**Why this priority**: Raw numbers without interpretation don't help the target audience. A clear verdict turns data into actionable information.

**Independent Test**: Run tests that produce each of the three verdict levels (no throttling, possible, strong signal) and verify the verdict text changes correctly. Delivers value by making results understandable.

**Acceptance Scenarios**:

1. **Given** all test targets report speeds within 15% of the baseline, **When** results are displayed, **Then** the verdict reads "No throttling detected" with a green indicator.
2. **Given** one or more targets report speeds 15–30% below the baseline, **When** results are displayed, **Then** the verdict reads "Possible throttling on [service names]" with a yellow indicator.
3. **Given** one or more targets report speeds more than 30% below the baseline, **When** results are displayed, **Then** the verdict reads "Strong throttling signal for [service names]" with a red indicator.
4. **Given** the test fails entirely (no results obtained), **When** results are displayed, **Then** the verdict reads "Unable to determine — tests could not complete" with a neutral indicator, and each failure reason is listed.

---

### Edge Cases

- **All tests fail**: The UI displays an error state explaining that no tests completed, lists each failure reason, and suggests checking internet connectivity. The JSON mode returns an error object with `status: "error"` and a `failures` array.
- **Browser doesn't support Web Workers**: All tests run sequentially on the main thread by design — no fallback needed. The application does not require Web Workers.
- **CORS blocks a fetch() request**: The test module automatically tries the fallback strategy (e.g., `new Image()` + Performance API resource timing). If both fail, the target is marked as failed with the reason "CORS restricted — could not measure this target".
- **User has a very fast connection** (>500 Mbps): The test adjusts the download payload size upward to ensure accurate measurement, up to a configured maximum (prevents tests from completing in <1s, which reduces accuracy). The payload is capped to avoid excessive data usage on metered connections.
- **User has a very slow connection** (<1 Mbps): The test uses a smaller initial payload to avoid timeouts. If even the small payload takes >30 seconds, the target is marked as timed out.
- **User opens in an older browser without Performance API**: The application detects missing APIs and displays a clear message: "Your browser doesn't support the performance measurement features needed to run these tests. Please try Chrome, Firefox, Safari, or Edge."
- **localStorage is full or disabled**: The application still runs tests and displays results but shows a warning: "Cannot save test history — browser storage is full or disabled." The user can still see results for the current session.
- **User rapidly clicks "Run Test"**: The button is disabled during an active test run. If a test is already running, subsequent clicks are ignored.
- **Empty history state**: The history section displays a message: "No tests run yet. Run your first test to start tracking your connection."
- **JSON mode with no prior tests**: Returns valid JSON with an empty results array and informative metadata (timestamp null, status "no_data").

## Requirements *(mandatory)*

### Functional Requirements

#### Core Orchestration

- **FR-001**: The application MUST provide a test runner that loads all registered test plugin modules, executes them sequentially on the main thread with `Promise.race()` timeout guards, collects results, and presents them to the user.
- **FR-002**: The application MUST support both managed tests (fast.com, Speedtest.net, etc.) and manufactured tests (downloads from known CDN origins) through the same plugin interface.
- **FR-003**: The test runner MUST disable the "Run Test" button during an active test run and re-enable it upon completion or failure.

#### Plugin Interface

- **FR-004**: Every test plugin MUST conform to a common interface that exposes: `{ name: string, description: string, origin: string, run(config: TestConfig) -> Promise<TestResult> }`.
- **FR-005**: The `TestResult` object returned by each plugin MUST include: `{ targetName: string, status: "success" | "error" | "timeout", downloadSpeedMbps: number | null, durationMs: number, bytesTransferred: number, errorMessage: string | null, timestamp: ISO8601 string }`.
- **FR-006**: The `TestConfig` object passed to each plugin MUST include: `{ timeoutMs: number, maxPayloadBytes: number, adaptivePayload: boolean }`.
- **FR-007**: Adding a new test target MUST NOT require changes to the core test runner or result display logic. The new plugin is registered and automatically included in future test runs.

#### Speed Measurement

- **FR-008**: Test plugins MUST use the Performance API (`performance.now()`) to measure download timing, and MUST use Resource Timing (`transferSize`, `duration`) where available for more precise measurements.
- **FR-009**: Test plugins MUST implement CORS fallback strategies. When a `fetch()` request is blocked by CORS, the plugin MUST attempt fallback measurement (e.g., `new Image()` loading a known-large resource and measuring timing via Performance API or Resource Timing).
- **FR-010**: Test plugins MUST adapt payload size based on observed speed: start with a small probe (e.g., 128KB), measure throughput, then scale up to a larger payload for accuracy, capping at `maxPayloadBytes`.
- **FR-011**: The application MUST configure a maximum total data transfer per test run (default: 200MB) to avoid excessive data usage on metered connections.

#### Results & Discrepancy Analysis

- **FR-012**: The application MUST display results in a comparison table showing each target's name, download speed in Mbps, status, and a discrepancy indicator relative to the baseline test.
- **FR-013**: The application MUST calculate discrepancy as the percentage deviation of each managed/manufactured test from the baseline (Speedtest.net or fastest result), and classify results as: ≤15% = normal, 15–30% = possible throttling, >30% = strong throttling signal.
- **FR-014**: The application MUST display a plain-language verdict summarizing the throttling analysis using green (normal), yellow (possible), red (strong signal), and gray (inconclusive) indicators.
- **FR-015**: Color-coded results MUST be accompanied by text labels and/or icons so that color is never the sole means of conveying information.

#### Test History

- **FR-016**: The application MUST persist test results to localStorage after each test run completes, keyed by timestamp.
- **FR-017**: The application MUST display a scrollable history list showing past test runs with timestamp and a one-line summary of findings.
- **FR-018**: Clicking a history entry MUST display the full results from that test run in the main results area.
- **FR-019**: When localStorage approaches capacity, the application MUST evict the oldest test entries to make room for new results.
- **FR-020**: The application MUST gracefully handle localStorage unavailability (full or disabled) by displaying results for the current session without persisting and showing a non-blocking warning.

#### JSON Mode

- **FR-021**: When the URL includes the query parameter `?format=json`, the application MUST render its output as a JSON document instead of the visual dashboard.
- **FR-022**: The JSON response MUST include an array of test result objects (each matching the TestResult schema) and metadata fields: `lastTestTimestamp`, `baselineName`, `verdict`.
- **FR-023**: When `?format=json` is provided and no test has been run, the response MUST return a valid JSON document with `results: []`, `lastTestTimestamp: null`, `verdict: "no_data"`.
- **FR-024**: The JSON response MUST include an `errors` array when any test failures occurred, describing each failure with target name and error message.

#### Accessibility

- **FR-025**: All interactive elements MUST be keyboard navigable with visible focus indicators following a logical tab order.
- **FR-026**: Status changes (test starting, test completing, error occurring) MUST be announced to screen readers via ARIA live regions.
- **FR-027**: The progress indicator MUST be annotated with `role="progressbar"` and appropriate `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-valuetext` attributes.
- **FR-028**: Color contrast ratios MUST meet WCAG 2.2 Level AA minimums: 4.5:1 for normal text, 3:1 for large text and UI components.
- **FR-029**: The results table MUST use proper `<table>` markup with `<caption>`, `<thead>`, `<tbody>`, and `<th scope="col/row">` elements.

#### Error Handling

- **FR-030**: Every test plugin MUST handle its own failures (CORS rejection, timeout, network error, rate limiting) without crashing the test runner, the UI, or affecting other plugins.
- **FR-031**: The application MUST detect missing browser APIs (Performance API, localStorage) at startup and display a clear, actionable message to the user before any test can be run.
- **FR-032**: All `fetch()` calls MUST include an `AbortController` with a timeout. Requests that exceed `timeoutMs` MUST be aborted and the target marked as timed out.

#### UI States

- **FR-033**: The application MUST display a progress indicator during test execution showing (a) which targets are currently running, (b) which have completed, (c) which have errored, and (d) overall progress as a fraction (e.g., "3 of 5 complete").
- **FR-034**: The application MUST display distinct UI states for: initial (no test run), running, complete (with results), complete (with errors), error (all failed), history empty, and localStorage unavailable.

#### MVP Test Targets

- **FR-035**: The application MUST include a fast.com test plugin (Netflix's CDN / Open Connect infrastructure), measuring download speed from Netflix's speed test service.
- **FR-036**: The application MUST include a Speedtest.net or LibreSpeed test plugin serving as the baseline (unthrottled reference) for discrepancy comparison.
- **FR-037**: The application MUST include at least 2 manufactured test plugins that download known-large resources from different CDN origins (e.g., Google CDN, CloudFront, Cloudflare) to serve as additional data points.

### Key Entities

- **TestPlugin**: A module implementing the plugin interface. Attributes: name, description, origin (the CDN or service being tested), run() method. It is stateless — the test runner manages execution.
- **TestConfig**: Configuration passed to each plugin at execution time. Attributes: timeoutMs, maxPayloadBytes, adaptivePayload flag.
- **TestResult**: The standardized output from a plugin's run() method. Attributes: targetName, status (success/error/timeout), downloadSpeedMbps, durationMs, bytesTransferred, errorMessage, timestamp.
- **TestRun**: A collection of TestResults from a single execution. Attributes: runId (timestamp-based), results (array of TestResult), baselineTarget (the reference speed test used for comparison), verdict (derived from discrepancy analysis), timestamp.
- **Discrepancy**: A computed analysis between a target's speed and the baseline. Attributes: targetName, percentageDeviation, direction (slower/faster), isSignificant (boolean), classification (normal/possible_throttling/strong_signal).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can run a full differential speed test across all configured targets and see results in under 60 seconds on a 50 Mbps connection (excluding any single test timeout).
- **SC-002**: The discrepancy verdict correctly identifies throttling when a managed test (e.g., fast.com) reports less than half the speed of the baseline, with zero false negatives for discrepancies >40%.
- **SC-003**: A user can understand the throttling verdict and recommended actions without reading documentation, confirmed by usability testing with 3+ non-technical users.
- **SC-004**: The application loads and becomes interactive in under 3 seconds on a 5 Mbps connection.
- **SC-005**: Test history persists across browser restarts and survives at least 50 test runs before eviction is needed.
- **SC-006**: All interactive elements are operable via keyboard alone, with no keyboard traps, confirmed by manual WCAG audit.
- **SC-007**: The JSON mode returns a valid, schema-conformant JSON document for all states (no data, partial results, full results, errors) as verified by JSON Schema validation.
- **SC-008**: The application functions correctly on the latest 2 versions of Chrome, Firefox, Safari, and Edge without browser-specific workarounds or polyfills (graceful degradation for missing features is acceptable).

## Assumptions

- Users have a modern browser (latest 2 versions of major browsers) with JavaScript enabled. The application provides a clear unsupported-browser message, but does not attempt to support IE11 or older.
- Users have a stable-enough internet connection to complete at least one test target. A completely offline browser is a detected edge case, not a supported use case.
- Test targets' CDN endpoints remain publicly accessible without authentication. If a service changes its endpoint or rate-limits the application, that test plugin will need an update — this is expected plugin maintenance.
- The baseline test (Speedtest.net or LibreSpeed) represents an unthrottled reference point. This assumption is generally valid, but ISPs could theoretically throttle those too. The discrepancy analysis is a signal, not proof.
- Mobile browsers are supported via responsive CSS, but mobile-specific features (pull-to-refresh, touch gestures) are out of scope for MVP.
- A single user per browser session. No multi-user support, no authentication, no cloud sync.
- The application is deployed as static files on GitHub Pages via the `main` branch. No CI/CD pipeline is required for MVP but may be added later.
- Tests run sequentially on the main thread (not in Web Workers). This architectural decision was made after discovering that parallel execution via Web Workers caused false-positive throttling signals — plugins competing for the same bandwidth artificially lowered individual speed measurements. Sequential execution ensures each plugin gets full access to the network pipe for accurate results.

## Out of Scope

The following are explicitly **not** part of this feature:

- **Upload speed testing**: Only download speed is measured for throttling detection. Upload throttling is a separate concern.
- **Latency/jitter measurement**: Only throughput (bandwidth) is measured. Latency analysis is a potential future feature.
- **Automated scheduled testing**: The user must manually initiate each test run. Background/cron testing is out of scope.
- **Network path analysis** (traceroute, packet inspection): The tool only measures end-to-end throughput; it does not diagnose where in the network throttling occurs.
- **ISP database/reporting**: Results are local to the user's browser. There is no central database, no sharing, and no aggregation of results across users.
- **Mobile apps**: Browser-based only. Native iOS/Android apps are out of scope.
- **Custom test target configuration by users**: The set of test targets is defined by the installed plugins. Users cannot add arbitrary URLs through the UI (though developers can add new plugins).
- **Dark mode toggle**: The UI uses a single, accessible color scheme optimized for readability. Dark mode is a potential enhancement.
- **Real-time graph/chart during testing**: Results are shown after completion. Live-updating charts during test execution are out of scope for MVP.

## Open Questions

_None at this time — all requirements have been derived from the product owner's specification._

## Clarifications Applied

> Populated during Phase 3. See entries below from clarification sessions.
