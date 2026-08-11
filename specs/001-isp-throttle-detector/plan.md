# Implementation Plan: ISP Throttle Detector

**Branch**: `001-isp-throttle-detector` | **Date**: 2026-08-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-isp-throttle-detector/spec.md`

## Summary

A pure client-side web application that detects ISP throttling by running differential speed tests against multiple service origins (Netflix CDN, Cloudflare, Google CDN, jsDelivr) and comparing results. The core insight: ISPs often throttle specific services (Netflix, YouTube) while leaving generic speed tests untouched. A significant discrepancy between e.g. the fast.com measurement (Netflix infrastructure) and the Cloudflare baseline is a strong throttling signal.

The application follows a plugin architecture — each test target is a self-contained module conforming to a common interface. The test runner loads all registered plugins and executes them sequentially on the main thread with `Promise.race()` timeout guards. Sequential execution ensures each plugin gets full access to the network pipe for accurate measurements (parallel execution caused false-positive throttling by splitting bandwidth). Results are collected, discrepancy analysis performed, and findings presented in an accessible comparison table. A `?format=json` URL parameter switches to machine-readable JSON output.

## Technical Context

**Language/Version**: JavaScript (ES2020+), no transpilation required

**Primary Dependencies**: Zero runtime dependencies. Development dependencies: Vitest (testing), ESLint with eslint-config-shaunburdick (linting), jsdom (DOM testing environment)

**Storage**: localStorage for test history persistence (key: `throttle-detector-history`)

**Testing**: Vitest + jsdom for unit/integration tests. ≥80% line coverage for plugin interface, test runner, and utility code per constitution.

**Target Platform**: Modern browsers — latest 2 versions of Chrome, Firefox, Safari, Edge. Served as static files from GitHub Pages.

**Project Type**: Single-page web application (static site, no build step required for deployment)

**Performance Goals**: Time to Interactive < 2s on 10Mbps connection. Total page weight < 200KB uncompressed (constitution mandate). Full test run completes within 60s on 50Mbps connection.

**Constraints**: 
- No server-side component — static files only
- No external runtime dependencies
- Must work as `file://` during development (no web server required for basic UI)
- localStorage quota (~5MB) limits history size
- Cross-origin resource access limited by CORS policies
- Individual test timeout: 30s per plugin
- Time-based sampling: Each test runs for `sampleDurationMs` (default 10s), downloading chunks of increasing size until duration elapses, then calculates average speed from all samples

**Scale/Scope**: Single-user, single-browser-session. ~50 test history entries before eviction. 4 test plugins for MVP.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Client-Side Only | ✅ PASS | No server. localStorage for persistence. Static files on GitHub Pages. |
| II. Plugin Architecture | ✅ PASS | Every test target is a module conforming to `TestPlugin` interface. Adding a new target = drop in a new file, register it. No core orchestration changes. |
| III. Accessibility-First UI | ✅ PASS | Semantic HTML (`<table>`, `<caption>`, `<th scope>`), ARIA live regions, `role="progressbar"`, keyboard navigation, WCAG 2.2 AA color contrast (4.5:1 text, 3:1 large text/UI). Color never sole indicator — text labels and icons accompany color-coding. |
| IV. Dual-Mode Output | ✅ PASS | Default = interactive dashboard. `?format=json` = JSON document. Same underlying data via `ResultsPresenter` abstraction. |
| V. Lightweight & Minimal Dependencies | ✅ PASS | Zero runtime dependencies. Vanilla JS + CSS Custom Properties. No framework (SPA complexity does not warrant Preact). Expected page weight ~60KB. |
| VI. Graceful Degradation | ✅ PASS | Each plugin handles own errors via try/catch. Partial results valid. Sequential execution with `Promise.race()` timeout guards prevents hangs. Performance API → unsupported browser message. localStorage → in-memory-only warning. CORS → `new Image()` fallback. |

**Complexity Tracking**: No violations. All constitution principles satisfied without exceptions.

## Architecture Overview

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                      index.html                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │                    app.js (entry point)            │  │
│  │  - Detects ?format=json → JSON mode               │  │
│  │  - Detects browser API support                    │  │
│  │  - Initializes modules                            │  │
│  └──────┬──────────┬──────────┬──────────────────────┘  │
│         │          │          │                          │
│  ┌──────▼──┐ ┌─────▼────┐ ┌──▼──────────────┐          │
│  │  UI     │ │ History  │ │  TestRunner      │          │
│  │ Manager │ │ Manager  │ │  (Orchestrator)  │          │
│  │         │ │          │ │                  │          │
│  │ - DOM   │ │ - CRUD   │ │ - Load plugins   │          │
│  │   render│ │ - Evict  │ │ - Run sequentially│          │
│  │ - States│ │ - Persist│ │ - Collect results│          │
│  │ - Events│ │          │ │ - Abort/timeout  │          │
│  │ - A11y  │ │          │ │ - Timeout guards │          │
│  └────┬─────┘ └────┬─────┘ └──┬──────────────┘          │
│       │            │           │                          │
│  ┌────▼────────────▼───────────▼──────────────────┐     │
│  │              ResultsAnalyzer                     │     │
│  │  - Discrepancy calculation                       │     │
│  │  - Verdict generation (normal/possible/strong)   │     │
│  │  - Baseline selection                            │     │
│  └─────────────────────────────────────────────────┘     │
│                                                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │              ResultsPresenter                     │    │
│  │  - HTML mode: renders comparison table + verdict  │    │
│  │  - JSON mode: serializes to JSON document         │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. User clicks "Run Test"
   │
2. TestRunner.runAll() called
   │
3. For each registered plugin (sequential):
   ├─ Start Promise.race([plugin.run(config), timeout])
   ├─ Plugin executes on main thread:
   │   ├─ Adaptive payload sizing
   │   ├─ fetch() with AbortController
   │   ├─ Measure via performance.now() / Resource Timing
   │   └─ Fallback to new Image() if CORS blocks fetch
   ├─ Timeout guard aborts if plugin exceeds timeoutMs
   └─ Collect result (success or error)
   │
4. TestRunner collects all results
    │
5. ResultsAnalyzer processes:
    ├─ Identify baseline (Cloudflare - fastest result)
    ├─ Calculate % deviation for each target
    ├─ Classify: ≤15% normal, 15-30% possible, >30% strong
    └─ Generate plain-language verdict
    │
6. ResultsPresenter renders:
    ├─ HTML mode: comparison table + verdict + history
    └─ JSON mode: structured JSON document
    │
7. HistoryManager.persist(testRun)
```

### Routing / Mode Selection

```
URL: /                    → default mode (HTML dashboard)
URL: /?format=json        → JSON mode (return JSON document)
URL: /?format=json&run    → JSON mode + trigger auto-run (future)
```

Mode detection happens in `app.js` at startup, before any module initialization. The `ResultsPresenter` is the single abstraction that handles both output formats.

## Project Structure

### Documentation (this feature)

```text
specs/001-isp-throttle-detector/
├── plan.md              # This file
├── research.md          # CORS research, serial execution rationale, API analysis
├── data-model.md        # TypeScript interfaces for all entities
├── quickstart.md        # Setup, run, test instructions
├── contracts/           # Internal API contracts
│   ├── plugin-interface.md
│   ├── worker-message-format.md  # OBSOLETE — preserved for historical reference
│   └── test-module-registration.md
└── tasks.md             # Phase 5 output
```

### Source Code (repository root)

```text
src/
├── app.js                    # Entry point: mode detection, init, bootstrap
├── lib/
│   ├── test-runner.js        # Plugin loading, sequential dispatch, result collection
│   ├── results-analyzer.js   # Discrepancy calculation, verdict generation
│   ├── results-presenter.js  # Dual-mode output (HTML table + JSON)
│   ├── history-manager.js    # localStorage CRUD, eviction, serialization
│   ├── ui-manager.js         # DOM manipulation, state management, events
│   └── utils.js              # Shared utilities (MB/s calc, formatTime, etc.)
├── plugins/
│   ├── plugin-registry.js    # Central registry: addPlugin(), getPlugins()
│   ├── fast-com.js           # fast.com plugin (Netflix CDN)
│   ├── cloudflare.js         # Cloudflare baseline plugin
│   ├── google-cdn.js         # Google CDN manufactured test
│   └── jsdelivr.js           # jsDelivr CDN manufactured test

└── styles/
    └── main.css              # All styles, CSS Custom Properties for theming

test-assets/                  # Test data & helper resources
├── 1mb.bin                   # 1MB dummy file for offline/local testing
├── 10mb.bin                  # 10MB dummy file
└── 25mb.bin                  # 25MB dummy file

tests/
├── unit/
│   ├── test-runner.test.js
│   ├── results-analyzer.test.js
│   ├── history-manager.test.js
│   ├── utils.test.js
│   └── plugin-registry.test.js
├── integration/
│   ├── full-flow.test.js
│   └── json-mode.test.js
└── contract/
    └── plugin-interface.test.js

index.html                   # Main entry point (loads app.js)
package.json                 # Dev dependencies only
.editorconfig                # Editor settings (from style config)
eslint.config.js             # ESLint config
vite.config.js               # Vite config (dev server only, not build step)
```

**Structure Decision**: Single project with `src/` containing all JS modules. No framework — vanilla JS with ES modules. `test-assets/` contains binary files used by manufactured test plugins when deployed (same-origin, no CORS issues). `tests/` mirrors `src/` structure. Vite is used only as a dev server with HMR; deployment copies static files directly to GitHub Pages.

## Test Plugin Architecture

### Interface Contract

```js
// Every plugin must export an object conforming to this shape:
{
  id: string,              // Unique identifier (e.g., 'fast-com', 'cloudflare')
  name: string,            // Human-readable name (e.g., 'Fast.com (Netflix)')
  description: string,     // One-line description of what this tests
  category: 'streaming' | 'cdn' | 'manufactured',
  run(config: TestConfig): Promise<TestResult>
}
```

### Registration

```js
// In plugin-registry.js
import { fastComPlugin } from './fast-com.js';
import { cloudflarePlugin } from './cloudflare.js';
import { googleCdnPlugin } from './google-cdn.js';
import { jsdelivrPlugin } from './jsdelivr.js';

const registry = new Map();

export function registerPlugin(plugin) {
  registry.set(plugin.id, plugin);
}

export function getPlugins() {
  return [...registry.values()];
}

// Register all plugins
registerPlugin(fastComPlugin);
registerPlugin(cloudflarePlugin);
registerPlugin(googleCdnPlugin);
registerPlugin(jsdelivrPlugin);
```

### Sequential Execution

The TestRunner iterates through registered plugins sequentially on the main thread. Each plugin's `run()` function is called directly and guarded by `Promise.race()` against a timeout:

```js
// test-runner.js
async function runAll(plugins, config) {
  const results = [];
  for (const plugin of plugins) {
    try {
      const result = await Promise.race([
        plugin.run(config),
        timeout(config.timeoutMs, plugin.id)
      ]);
      results.push(result);
    } catch (error) {
      results.push(createErrorResult(plugin, error));
    }
  }
  return results;
}
```

Plugins execute one at a time, ensuring each test gets full access to the available bandwidth. This avoids the false-positive throttling signals that arose from parallel Web Worker execution (where plugins competed for bandwidth).

## Key Design Decisions

### 1. Plugin execution model

**Decision**: Plugins execute sequentially on the main thread via `Promise.race()` timeout guards. Each plugin's `run()` function is called directly — no serialization, no Workers, no message passing.

**Rationale**: Parallel Web Worker execution caused false-positive throttling detection: multiple plugins downloading simultaneously competed for the same network bandwidth, artificially lowering individual speed measurements. Sequential execution ensures each plugin gets the full pipe, producing accurate measurements. Main-thread responsiveness is maintained by time-bounded execution (each plugin is capped at `timeoutMs`, default 30s), and the `Promise.race()` pattern ensures no single plugin can hang the runner.

**Tradeoff**: Total test duration is now the sum of individual plugin durations rather than the max. For 4 plugins at ~10s each, total runtime is ~40s — well within the SC-001 60s target. The tradeoff of longer total time for significantly more accurate results (eliminating false positives) is the correct engineering decision.

### 2. Baseline selection

**Decision**: The Cloudflare plugin serves as the default baseline. If Cloudflare fails, the fastest successful manufactured test becomes the baseline. If no manufactured tests succeed, use any successful test. If only fast.com succeeds, show results without discrepancy (display "no baseline" warning).

**Rationale**: Cloudflare's endpoint is the most reliable, has proper CORS/Timing-Allow-Origin headers, and represents a general-purpose CDN (not tied to any specific streaming service). This provides the cleanest "unthrottled reference."

### 3. CORS fallback strategy (in priority order)

1. **fetch()** — Preferred method. Works when server sends appropriate CORS headers or `Timing-Allow-Origin`.
2. **`new Image()` + Performance API** — Fallback when fetch is CORS-blocked. Load a known-large resource URL as an image, measure via `responseEnd - fetchStart` (available cross-origin without `Timing-Allow-Origin`). Cannot determine `transferSize` so uses `decodedBodySize` estimation.
3. **XHR with no-cors mode** — Last resort for progress-capable downloads where timing matters. Limited information available.

### 4. JSON mode implementation

**Decision**: JSON mode is detected in `app.js` before UI initialization. When active, `ResultsPresenter` outputs raw JSON to `document.body` and stops DOM rendering. The test can still be triggered (either from a prior run in localStorage, or by a future auto-run parameter `?format=json&run`).

**Rationale**: The spec (FR-021, FR-023) requires JSON mode to return the most recent results from localStorage without requiring a new test. Detection happens early to avoid unnecessary DOM work.

### 5. No LibreSpeed dependency

**Decision**: We use Cloudflare's speed test endpoint as the baseline instead of LibreSpeed or Speedtest.net.

**Rationale**: 
- Speedtest.net requires a paid Ookla license ($unknown cost)
- LibreSpeed requires hosting a PHP backend — violates Principle I (Client-Side Only)
- LibreSpeed's public demo (librespeed.org) is not designed as a public API and may have rate limits or change without notice
- Cloudflare's `speed.cloudflare.com/__down` endpoint is designed for programmatic access, has proper CORS/Timing-Allow-Origin headers, and is maintained by a major infrastructure company

**Deviation from FR-036**: FR-036 specifies "Speedtest.net or LibreSpeed." We're using Cloudflare instead. See architect concerns below for the product owner to weigh in.

## MVP Test Plugins

| Plugin ID | Name | Category | Approach | CORS Strategy |
|-----------|------|----------|----------|---------------|
| `fast-com` | Fast.com (Netflix) | streaming | Extract token from fast.com → fetch OCA URLs → parallel download from Netflix CDN | fetch() with `responseEnd - fetchStart` cross-origin timing; fall through error if blocked |
| `cloudflare` | Cloudflare (Baseline) | cdn | Download from `speed.cloudflare.com/__down?bytes=N` | fetch() with full TIMING (has `Timing-Allow-Origin`) |
| `google-cdn` | Google CDN | cdn | Download from Google CDN resource | fetch() first; fallback to `new Image()` + Performance API |
| `jsdelivr` | jsDelivr CDN | cdn | Download large npm package file from `cdn.jsdelivr.net` | fetch() with full CORS (jsDelivr sends `Access-Control-Allow-Origin: *`) |

## State Management

The application has minimal state — no reactive framework needed:

```
App State (ui-manager.js):
  mode: 'html' | 'json'
  uiState: 'initial' | 'running' | 'complete' | 'error-full'
  lastTestRun: TestRun | null
  history: TestRun[]
  warnings: string[]           // localStorage full, unsupported browser, etc.

localStorage:
  key: 'throttle-detector-history'
  value: JSON.stringify(TestRun[])
```

State transitions:
```
initial → [click Run Test] → running → [all complete] → complete
                                    → [all failed]  → error-full
                                    → [partial fail] → complete (with errors)
```

All state changes flow through `ui-manager.js`, which re-renders the appropriate DOM sections. No virtual DOM — direct DOM manipulation with targeted updates.

## Error Handling Strategy

| Error Scenario | Handling | User Experience |
|---------------|----------|-----------------|
| Plugin CORS blocked | Plugin attempts fallback; if all fail, returns `status: 'error'` | Row shows "CORS restricted" error message |
| Plugin timeout (>30s) | AbortController aborts; plugin returns `status: 'timeout'` | Row shows "Timed out after 30s" |
| All plugins fail | Runner returns empty results | Full error state: "Unable to determine — tests could not complete" |
| Web Workers unsupported | N/A — tests always run sequentially on the main thread | No special handling needed |
| Performance API missing | App detects at startup, shows message | Full error: "Your browser doesn't support the needed performance measurement features" |
| localStorage full/disabled | HistoryManager returns in-memory fallback | Warning banner: "Cannot save test history — browser storage is full or disabled" |
| Rapid "Run Test" clicks | Button disabled during run | Button grayed out with "Testing..." label |
| Very fast connection (>500Mbps) | Plugin enlarges payload up to maxPayloadBytes | Transparent to user |
| Very slow connection (<1Mbps) | Plugin uses small initial payload (128KB) | Transparent to user |

## Architect Concerns for Product Owner

### Previously Resolved

1. **Baseline deviation (FR-036)**: The spec calls for Speedtest.net or LibreSpeed as the baseline. We're using Cloudflare instead. **Resolved**: PO accepted Cloudflare as the baseline.
2. **Time-based sampling (Decision Change)**: The original plan used a 200MB byte cap (`maxPayloadBytes`). **Resolved**: PO directed replacement with time-based sampling (`sampleDurationMs`, default 10s). See research.md for updated adaptive strategy.

### Open Concerns (for PO review)

1. **fast.com token extraction fragility**: The fast.com plugin extracts an app token by fetching fast.com's HTML, locating the app.js script, fetching it, and regex-extracting the token. This is the approach used by open-source projects like `fast-speedtest-api` and `fast.com` npm packages. However, if Netflix changes their JavaScript bundle structure, the plugin breaks. **Mitigation**: The plugin handles token extraction failure gracefully (reports "Could not reach fast.com API"), and the token extraction logic is isolated in a single function that can be updated without changing the plugin's measurement logic.
2. **Google CDN test reliability**: Finding a reliable, large, CORS-friendly resource on Google's CDN is challenging. Google Cloud Storage buckets can be configured with CORS but public buckets may not have it. The `new Image()` fallback approach works but provides less accurate timing than fetch(). **Mitigation**: We'll identify 2-3 candidate URLs and try them in sequence. The plugin returns an error if all fail, and the test run proceeds with partial results.
