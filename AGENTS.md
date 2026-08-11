# AGENTS.md — ISP Throttle Detector

AI coding agent instructions for the ISP Throttle Detector project. This file defines conventions, architecture patterns, quality gates, and anti-patterns. **Read before writing code.**

---

## 1. Project Overview

The ISP Throttle Detector is a client-side web application that detects ISP throttling by running sequential speed tests against multiple CDN origins and comparing results. If a connection shows 200 Mbps from Cloudflare but 50 Mbps from YouTube's CDN, that discrepancy signals selective ISP throttling.

**Deployment**: Pure static files served from GitHub Pages. Push to `main` to deploy. No build step, no server, no framework.

**Run it**: `npm install && npm start` → `http://localhost:8000`

---

## 2. Development Setup

```bash
npm install                # Install dev dependencies (vitest, eslint, jsdom)
npm start                  # Serve at http://localhost:8000 (uses `serve`)
npm test                   # Run all 172 tests (vitest + jsdom)
npm run test:watch         # Watch mode — re-runs on file changes
npm run test:coverage      # Coverage report — ≥80% line coverage required on lib/ and plugin-registry
npm run lint               # ESLint — zero errors, zero warnings (mandatory)
npm run lint:fix           # Auto-fix linting issues
```

There is **no build step**. The project is vanilla JS ES modules served directly. You can also open `index.html` as a `file://` URL for basic UI development, but `fetch()` calls require an HTTP server to work.

### Branch Naming

All work happens on feature branches following the `NNN-description` convention:

```
001-isp-throttle-detector
002-plugin-status-updates
003-agents-md
fix/measurement-accuracy
```

- ❌ **NEVER** commit to `main`, `master`, or `develop`
- ✅ **ALWAYS** create a feature branch and open a PR

---

## 3. Architecture

### 3.1 Module Responsibility Map

```
app.js (entry point)
  ├── Plugin imports (side-effect: self-registration)
  ├── ui-manager.js       → DOM rendering, progress bar, event wiring, inline confirm dialogs
  ├── test-runner.js      → Sequential orchestration: runs each plugin with Promise.race() timeout
  ├── results-analyzer.js → Discrepancy calculation, baseline selection, verdict generation
  ├── results-presenter.js→ Dual-mode: presentHtml() for dashboard, presentJson() for API
  ├── history-manager.js  → localStorage CRUD, trim-to-fit, quota-aware pruning
  ├── utils.js            → trimmedMean, bytesToMbps, formatMbps, generateRunId, average, median
  ├── dom-utils.js        → escapeHtml(), announce() — XSS-safe encoding + aria-live announcements
  ├── history-ui.js       → History rendering, inline confirm dialogs, focus trap
  ├── json-viewer.js      → Formatted JSON viewer page at ?view=json
  └── types.js            → JSDoc type definitions (pure documentation, no runtime exports)
```

### 3.2 Plugin System

Every test target is a **self-contained module in `src/plugins/`** that conforms to the `TestPlugin` interface:

```js
{
  id: 'cloudfront',              // Unique kebab-case identifier
  name: 'AWS CloudFront',        // Human-readable display name
  description: '...',            // One-line description
  category: 'cdn',               // 'streaming' | 'cdn' | 'manufactured'
  run(config): Promise<TestResult>  // The test execution function
}
```

**Self-registration**: Each plugin calls `registerPlugin(plugin)` from `src/lib/plugin-registry.js` at import time. The test runner discovers plugins via `getPlugins()` — no manual wiring, no central plugin list.

The registry validates at registration:
- All required fields present (`id`, `name`, `description`, `category`, `run`)
- `id` is a non-empty string
- `run` is a function
- `category` is one of `['streaming', 'cdn', 'manufactured']`
- No duplicate `id` values (throws on conflict)

### 3.3 Factory Pattern in plugin-runner.js

`src/lib/plugin-runner.js` (467 lines) is the **core abstraction**. It provides shared factories that eliminate duplicated code across plugins. **Plugins MUST use these factories** — never write raw sampling loops in a plugin.

| Factory / Helper | Purpose | Used by |
|---|---|---|
| `createBuildResult({ pluginId, targetName, category })` | Creates a `buildResult()` closure that fills in plugin-specific metadata on every result object | All 6 plugins |
| `createUrlBasedRunLoop({ buildResult, urls, downloadFn })` | Creates a `run()` function that cycles through URLs, downloads full files, collects speed samples | YouTube, jsDelivr, Bunny CDN |
| `createRangeBasedRunLoop({ buildResult, resolveUrl, downloadFn, adaptiveFn })` | Creates a `run()` function that lazily resolves a base URL, then downloads byte ranges with adaptive chunk sizing | CloudFront, GitHub |
| `createChunkBasedRunLoop({ buildResult, sizes, buildUrl, nextChunk, downloadFn })` | Creates a `run()` function that uses pre-configured chunk sizes with a dynamic sizing strategy | Cloudflare |
| `downloadFullFile({ url, timeoutMs })` | Downloads an entire file via fetch, measures throughput with Resource Timing API | YouTube, jsDelivr, Bunny CDN |
| `downloadRange({ url, chunkBytes, timeoutMs })` | Downloads a byte range, uses `blob.size` for byte counting (not `transferSize`) | CloudFront, GitHub |
| `withAbortTimeout(timeoutMs, fn)` | Wraps an async operation with an `AbortController` timeout | `downloadFullFile`, `downloadRange`, GitHub's `resolveUrl` |
| `withFetchTimeout(timeoutMs, fn)` | Wraps a fetch operation with timeout, catching all errors to return `zeroSample()` | Used by `downloadFullFile` and `downloadRange` |
| `resolveByteCount(url, fallbackBytes)` | Resolves bytes transferred via Resource Timing API (`getEntriesByName` — O(1)), falling back to `Content-Length` | `downloadFullFile`, Cloudflare's `downloadAndMeasure` |
| `adaptRangeChunkSize(samples, opts)` | Picks next Range-request chunk size (64 KiB → 25 MiB) based on recent speed samples | CloudFront, GitHub |
| `zeroSample()` | Returns `{ bytes: 0, speedMbps: 0, durationMs: 0 }` — safe zero-value sample | Error handling in fetch wrappers |

**The run-loop architecture**:

```
createRunLoop({ buildResult, nextSample })
  ├── createUrlBasedRunLoop    ← nextSample cycles URLs
  ├── createRangeBasedRunLoop  ← nextSample lazily resolves URL, adapts chunk size
  └── createChunkBasedRunLoop  ← nextSample uses pre-configured sizes + strategy function
```

Every run loop factory uses `createRunLoop()` internally, which:
1. Runs a `while` loop for `sampleDurationMs` (default 10s)
2. Excludes samples from the first `DEFAULT_WARMUP_DURATION` (1s) — warmup period
3. Computes final speed via `trimmedMean(samples)` — trims 10% from each tail
4. Returns a standardized `TestResult` via `buildResult()`

### 3.4 Serial Execution Rationale

Tests run **sequentially on the main thread** with `Promise.race()` timeout guards. This is an intentional architectural decision, not a limitation.

**Why**: Parallel execution (via Web Workers) caused false-positive throttling detection. Multiple plugins downloading simultaneously competed for the same network bandwidth, artificially lowering individual speed measurements. Sequential execution ensures each plugin gets the full pipe.

**Tradeoff**: Total test duration = sum of individual plugin durations (~40s for 6 plugins at ~10s each). This is well within the 60s success criterion, and the accuracy gain is worth it.

Web Workers and `workerCompatible` were removed in constitution v1.2.0. Do not reintroduce them.

### 3.5 Time-Based Sampling

Each test runs for `sampleDurationMs` (default 10s), not a fixed byte count. During the sampling window:
- The plugin downloads resources repeatedly
- Samples within the first 1s (warmup) are excluded
- Remaining samples go through `trimmedMean()` to remove outliers
- Total bytes transferred is tracked for data-usage transparency

This auto-scales across connection speeds: slow connections download fewer bytes, fast connections download more, but every test gets the same measurement duration.

### 3.6 Dual-Mode Output

The `ResultsPresenter` abstraction (`src/lib/results-presenter.js`) provides two methods from a single set of data:

- **`presentHtml(run)`** → HTML string with color-coded comparison table, verdict card, and warnings
- **`presentJson(run)`** → JSON string with results array, discrepancies, verdict, and errors

Mode detection happens in `app.js` via `?format=json` URL parameter, before any DOM initialization.

---

## 4. Quality Gates (Non-Negotiable)

Every commit must pass these gates. No exceptions.

### 4.1 Lint — Zero Tolerance

```bash
npm run lint   # Must pass: zero errors, zero warnings
```

- ❌ **NEVER** use `eslint-disable`, `eslint-disable-next-line`, or any suppression comment
- ✅ **ALWAYS** refactor the code to comply with the rule
- If a rule genuinely conflicts with the project's needs, adjust the **lint config** (`eslint.config.mjs`) — never suppress inline

### 4.2 Tests — All Passing

```bash
npm test   # 172 tests across 8 files — all must pass
```

Test files:
| File | Tests | Purpose |
|---|---|---|
| `tests/unit/utils.test.js` | 25 | trimmedMean, bytesToMbps, formatMbps, etc. |
| `tests/unit/ui-manager.test.js` | 30 | DOM rendering, progress, confirm dialogs |
| `tests/unit/plugins.test.js` | 74 | Individual plugin behavior |
| `tests/unit/history-manager.test.js` | 15 | localStorage CRUD, eviction, pruning |
| `tests/unit/results-analyzer.test.js` | 8 | Discrepancy thresholds, verdict levels |
| `tests/unit/test-runner.test.js` | 4 | Sequential execution, timeout handling |
| `tests/contract/plugin-interface.test.js` | 16 | Plugin contract conformance |
| `tests/integration/full-flow.test.js` | 4 | End-to-end: runner → analyzer → presenter |

### 4.3 Commits — Conventional Commits

```
feat: add new test plugin for Hulu CDN
fix: handle null response in downloadRange
refactor: extract shared timeout logic
docs: update plugin creation guide
test: add edge case for empty sample array
chore: update eslint-config-shaunburdick
ci: add deploy workflow
```

### 4.4 No console.log

No `console.log`, `console.warn`, or `console.error` statements in committed code. Remove debug logging before committing.

### 4.5 WCAG 2.2 AA Accessibility

- Semantic HTML: `<table>` with `<caption>`, `<thead>`, `<tbody>`, `scope` attributes
- Color contrast ≥ 4.5:1 for normal text, ≥ 3:1 for large text and UI components
- All interactive elements are keyboard-navigable with visible focus indicators
- `aria-live="polite"` region for status announcements
- `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- Color never the sole indicator of state — always paired with text labels
- `prefers-reduced-motion` respected in CSS

### 4.6 Page Weight

Total page weight must stay under 200KB (uncompressed). No external runtime dependencies.

### 4.7 XSS Safety

**All** dynamic content inserted into HTML MUST pass through `escapeHtml()` from `src/lib/dom-utils.js`:

```js
import { escapeHtml } from './dom-utils.js';
// ...
element.innerHTML = `<td>${escapeHtml(userProvidedString)}</td>`;
```

`escapeHtml()` uses a browser-native `textContent` setter — the safest way to HTML-encode arbitrary strings without an external library.

For attribute values, use `escAttr()` (defined in `ui-manager.js`):

```js
function escAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

---

## 5. Adding a New Test Plugin

Follow this step-by-step process. Most plugins need only **30–40 lines** because the factories in `plugin-runner.js` handle all the boilerplate.

### Step 1: Choose Your Plugin Type

| Plugin Type | Factory | When to Use |
|---|---|---|
| URL-cycling (full file) | `createUrlBasedRunLoop` | Multiple known URLs that support `fetch()` + CORS + Timing-Allow-Origin |
| Range-request (adaptive) | `createRangeBasedRunLoop` | One base URL that supports `Range` header, chunk size auto-scales by speed |
| Chunk-based (sized) | `createChunkBasedRunLoop` | One endpoint that accepts a `?bytes=N` parameter, manual chunk size strategy |

### Step 2: Create the Plugin File

Create `src/plugins/my-plugin.js`:

```js
/**
 * My CDN speed test plugin.
 *
 * @module plugins/my-plugin
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import {
    createBuildResult, createUrlBasedRunLoop, downloadFullFile,
} from '../lib/plugin-runner.js';

const MY_URLS = [
    'https://cdn.example.com/speedtest/file1.bin',
    'https://cdn.example.com/speedtest/file2.bin',
];

const buildResult = createBuildResult({
    pluginId: 'my-plugin',
    targetName: 'My CDN',
    category: 'cdn',
});

const myPlugin = {
    id: 'my-plugin',
    name: 'My CDN',
    description: 'Download speed from My CDN infrastructure',
    category: 'cdn',
    run: createUrlBasedRunLoop({
        buildResult,
        urls: MY_URLS,
        downloadFn: downloadFullFile,
    }),
};

registerPlugin(myPlugin);
export { myPlugin };
```

For a **Range-request plugin**:

```js
import {
    createBuildResult, createRangeBasedRunLoop,
    downloadRange, adaptRangeChunkSize,
} from '../lib/plugin-runner.js';

const buildResult = createBuildResult({
    pluginId: 'my-range-plugin',
    targetName: 'My Range CDN',
    category: 'cdn',
});

async function resolveUrl() {
    return 'https://cdn.example.com/large-file.bin';
}

const myRangePlugin = {
    id: 'my-range-plugin',
    name: 'My Range CDN',
    description: 'Download speed from My CDN via Range requests',
    category: 'cdn',
    run: createRangeBasedRunLoop({
        buildResult,
        resolveUrl,
        downloadFn: downloadRange,
        adaptiveFn: adaptRangeChunkSize,
    }),
};

registerPlugin(myRangePlugin);
export { myRangePlugin };
```

### Step 3: Import in app.js

Add the import to `src/app.js` alongside existing plugin imports:

```js
import './plugins/my-plugin.js';
```

### Step 4: Verify

```bash
npm run lint    # Zero errors, zero warnings
npm test        # All 172+ tests passing
```

That's it. No changes to `test-runner.js`, `results-analyzer.js`, `results-presenter.js`, `ui-manager.js`, or `index.html` are required.

---

## 6. Code Conventions

### JavaScript

- **Vanilla JS ES2020+** — ES modules (`import`/`export`), no transpilation
- **`const`** by default, **`let`** when needed, **never `var`**
- **`async/await`** over promise chains (`.then()` / `.catch()`)
- **Early returns / guard clauses** — prefer over deep nesting:

  ```js
  // ✅ Good
  function process(data) {
      if (!data) return null;
      if (!data.valid) return null;
      return transform(data);
  }

  // ❌ Avoid
  function process(data) {
      if (data) {
          if (data.valid) {
              return transform(data);
          }
      }
      return null;
  }
  ```

- **Destructured params** for functions with 3+ arguments:

  ```js
  // ✅ Good
  function run({ plugins, config, onProgress, onPluginStart }) { ... }

  // ❌ Avoid
  function run(plugins, config, onProgress, onPluginStart) { ... }
  ```

- **Guards for empty/null inputs** — every public function validates its inputs:

  ```js
  if (!urls || urls.length === 0) { return errorResult; }
  ```

### JSDoc

All public functions must have JSDoc comments with `@param` and `@returns`. Use `@module` for each file. Type references use the `import('./types.js').TypeName` pattern for IDE support.

```js
/**
 * Creates a run() function for URL-cycling plugins.
 *
 * @param {{ buildResult: Function, urls: string[], downloadFn: Function }} opts
 * @returns {function(import('./types.js').TestConfig): Promise<import('./types.js').TestResult>}
 */
export function createUrlBasedRunLoop({ buildResult, urls, downloadFn }) { ... }
```

### Resource Timing API

- ✅ **`getEntriesByName(url)`** — O(1) lookup by URL (use this)
- ❌ **`getEntriesByType('resource')`** — O(n) scan of all resources (avoid this)

```js
// ✅ Correct — O(1)
const entries = performance.getEntriesByName(url);
if (entries.length > 0) {
    const entry = entries[entries.length - 1];
    // ...
}

// ❌ Incorrect — O(n) scan
const entries = performance.getEntriesByType('resource');
const match = entries.find(e => e.name === url);
```

### Content-Length Fallback

When `Timing-Allow-Origin` header is absent, Resource Timing `transferSize` returns 0. Always include a Content-Length fallback:

```js
const cl = resp.headers.get('content-length');
const contentLength = cl ? parseInt(cl, 10) : 0;
const bytes = resolveByteCount(cacheBust, contentLength);
```

### Range Request Byte Counting

For Range requests, use **`blob.size`**, not Resource Timing `transferSize`. Some CDNs report the full file size in `transferSize` for 206 Partial Content responses, inflating speed measurements:

```js
// ✅ Correct — actual bytes received
const blob = await resp.blob();
const bytes = blob.size;

// ❌ Incorrect — may report full file size
const entries = performance.getEntriesByName(url);
const bytes = entries[0].transferSize;
```

### No `eval()` or `new Function()`

Never use `eval()`, `new Function()`, or any dynamic code execution. Since Web Workers and serialization were removed, there is no reason to stringify or evaluate code.

### No Dynamic Imports for Core Modules

Always-used modules (`history-manager`, `results-presenter`, `utils`) should use static `import` at the top of the file. Reserve dynamic `import()` for truly conditional or lazy-loaded dependencies.

---

## 7. Anti-Patterns (What NOT to Do)

| ❌ Anti-Pattern | ✅ Do Instead |
|---|---|
| Write raw sampling loops in a plugin | Use `createUrlBasedRunLoop`, `createRangeBasedRunLoop`, or `createChunkBasedRunLoop` from `plugin-runner.js` |
| Use `transferSize` for Range request byte counting | Use `blob.size` — `transferSize` may report full file size for 206 responses |
| Use `eval()` or `new Function()` | No reason exists — Worker serialization was removed entirely |
| Add `eslint-disable` comments | Fix the code to comply with the rule |
| Use `window.confirm()`, `alert()`, or `prompt()` | Use `showInlineConfirm()` from `ui-manager.js` — accessible, focus-trapped inline confirmation |
| Use `<li role="button">` or `<div onclick="...">` | Use native `<button>` elements — they're keyboard-accessible by default |
| Duplicate logic between plugins | Extract to `plugin-runner.js` and share via factory functions |
| Skip Content-Length fallback when Timing-Allow-Origin is absent | Always provide `fallbackBytes` to `resolveByteCount()` |
| Use `getEntriesByType('resource')` for O(n) scan | Use `getEntriesByName(url)` for O(1) lookup |
| Use dynamic imports for always-needed modules | Use static `import` at the top of the file |
| Write plugins that throw exceptions | Catch all errors and return a `TestResult` with `status: 'error'` |
| Use `var` | Use `const` (default) or `let` (when reassignment needed) |
| Use hard byte caps for test duration | Use time-based sampling (`sampleDurationMs`) — auto-scales to connection speed |
| Run plugins in parallel (Web Workers) | Run sequentially on main thread — prevents false-positive throttling |
| Use `console.log` in committed code | Remove all debug logging before committing |
| Use color as the sole indicator | Always pair color with text labels (badges, icons, or text) |

---

## 8. Accessibility Requirements

Every UI change must meet these requirements:

### Content Safety
- All dynamic text → `escapeHtml()` from `dom-utils.js`
- All dynamic attributes → `escAttr()` from `ui-manager.js`

### Interactive Elements
- All clickable elements: use native `<button>` (not `<div onclick>`, `<li role="button">`, `<span onclick>`)
- All buttons have `aria-label` when the visible text alone is insufficient
- Focus indicators are visible on all interactive elements

### Live Regions & Announcements
- Status updates go through `announce(msg)` from `ui-manager.js` → writes to `#status-live` element with `aria-live="polite"`
- Progress announcements are rate-limited: max one per 1 second, or one per 2 completed tests
- Verdict card uses `role="status" aria-live="polite"` for auto-announcement

### Progress Bar
- `role="progressbar"` with full ARIA attributes:
  - `aria-valuenow` — current count (not percentage)
  - `aria-valuemin="0"`
  - `aria-valuemax` — total plugin count
  - `aria-label="Test progress"`

### Focus Management
- After results render, focus moves to the `#results-heading` element
- Inline confirm dialogs (`showInlineConfirm`) implement a focus trap cycling between Yes/Cancel buttons on Tab/Shift+Tab, dismiss on Escape, cancel on outside click

### Color & Motion
- Color never sole indicator — success/error states use both color and checkmark/cross icons plus text labels
- `prefers-reduced-motion` media query respected in CSS animations

### Confirm Dialogs
- Use `showInlineConfirm(triggerEl, message, onConfirm)` from `ui-manager.js`
- Never use `window.confirm()` — it blocks the main thread and is not screen-reader friendly

---

## 9. Testing

### Test Philosophy
- **Behavioral tests**: Assert user-visible outcomes, not implementation details
- Tests use `vitest` + `jsdom` for DOM testing
- The mock plugin factory at `tests/helpers/mock-plugin.js` provides a reusable `createMockPlugin()` for consistent test setup

### Running Tests

```bash
npm test                # All 172 tests
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

### Test Organization

```
tests/
├── unit/
│   ├── utils.test.js          # trimmedMean, bytesToMbps, formatting
│   ├── ui-manager.test.js     # DOM rendering, progress, confirm dialogs
│   ├── plugins.test.js        # Individual plugin behavior
│   ├── history-manager.test.js# localStorage CRUD, eviction, pruning
│   ├── results-analyzer.test.js # Discrepancy thresholds, verdict
│   └── test-runner.test.js    # Sequential execution, timeout
├── contract/
│   └── plugin-interface.test.js # Enforces TestPlugin contract
├── integration/
│   └── full-flow.test.js      # End-to-end: runner → analyzer → presenter
└── helpers/
    └── mock-plugin.js         # Reusable mock plugin factory
```

### Coverage Target
≥80% line coverage on `lib/` and `plugin-registry`, per constitution.

---

## 10. Deployment

Deployment to GitHub Pages is handled by GitHub Actions. Pushing to `main` triggers the workflow defined in `.github/workflows/deploy.yml`.

**Artifacts deployed** (only these):
- `index.html`
- `src/` directory
- `css/` directory

**Not deployed**: test files, specs, `test-assets/`, `node_modules/`, `package.json`.

The application works as pure static files — no build step, no server-side processing. Any HTTP server can serve it.

---

## 11. Spec Documents

This project follows spec-driven development:

| Document | Path | Purpose |
|---|---|---|
| Constitution | `.specify/memory/constitution.md` | Core principles and technical decisions (v1.2.0) |
| Feature Spec | `specs/001-isp-throttle-detector/spec.md` | User stories, requirements, edge cases |
| Implementation Plan | `specs/001-isp-throttle-detector/plan.md` | Architecture decisions, data flow, tech choices |
| Research | `specs/001-isp-throttle-detector/research.md` | CORS strategies, serial execution rationale |
| Data Model | `specs/001-isp-throttle-detector/data-model.md` | Entity definitions |
| Contracts | `specs/001-isp-throttle-detector/contracts/` | Plugin interface, module registration |
| Tasks | `specs/001-isp-throttle-detector/tasks.md` | Implementation task breakdown |

---

## 12. Key Constants

Constants defined across the codebase that you should not duplicate:

| Constant | Value | Location | Purpose |
|---|---|---|---|
| `DEFAULT_SAMPLE_DURATION` | `10000` (ms) | `plugin-runner.js` | Sampling window per test |
| `DEFAULT_WARMUP_DURATION` | `1000` (ms) | `plugin-runner.js` | Warmup before collecting samples |
| `DEFAULT_TIMEOUT` | `30000` (ms) | `plugin-runner.js` | Per-plugin timeout ceiling |
| `PER_FETCH_TIMEOUT` | `15000` (ms) | `plugin-runner.js` | Per-fetch timeout ceiling |
| `MAX_STORAGE_BYTES` | `4 * 1024 * 1024` | `history-manager.js` | localStorage quota (4 MB) |
| `MAX_ENTRIES` | `50` | `history-manager.js` | Max history entries before eviction |
| `STORAGE_KEY` | `'throttle-detector-history'` | `history-manager.js` | localStorage key |
| `NORMAL_THRESHOLD` | `15` (percentage) | `results-analyzer.js` | ≤15% = normal |
| `STRONG_THRESHOLD` | `30` (percentage) | `results-analyzer.js` | >30% = strong signal |
| `DEFAULT_TRIM_RATIO` | `0.1` | `utils.js` | Trim 10% from each tail |

---

## 13. Quick Reference: File Purposes

| File | Lines | Purpose |
|---|---|---|
| `src/app.js` | 501 | Entry point: mode detection, callback wiring, theme management, bootstrap |
| `src/lib/plugin-runner.js` | 467 | Shared factories: run loops, download helpers, byte counting |
| `src/lib/plugin-registry.js` | 85 | Plugin registration, validation, discovery |
| `src/lib/test-runner.js` | 115 | Sequential orchestration with `Promise.race()` timeout guards |
| `src/lib/results-analyzer.js` | 188 | Discrepancy calculation, baseline selection, verdict generation |
| `src/lib/results-presenter.js` | 276 | Dual-mode output: `presentHtml()`, `presentJson()`, `presentPluginChecklist()` |
| `src/lib/ui-manager.js` | 352 | DOM rendering, progress bar, plugin status, focus management |
| `src/lib/history-manager.js` | 199 | localStorage CRUD, quota-aware pruning, metadata stripping |
| `src/lib/history-ui.js` | 260 | History list rendering, inline confirmation dialogs, focus trap |
| `src/lib/json-viewer.js` | 78 | Formatted JSON viewer page at ?view=json |
| `src/lib/utils.js` | 214 | `trimmedMean`, `bytesToMbps`, `formatMbps`, `generateRunId`, `average`, `median` |
| `src/lib/dom-utils.js` | 41 | `escapeHtml()`, `announce()` — XSS-safe encoding + aria-live announcements |
| `src/lib/types.js` | 102 | JSDoc typedefs (documentation-only, no runtime exports) |
| `src/plugins/cloudflare.js` | 121 | Baseline: Cloudflare CDN with index-based chunk sizing |
| `src/plugins/cloudfront.js` | 45 | AWS CloudFront: Range requests with adaptive chunk sizing |
| `src/plugins/youtube.js` | 51 | YouTube/Google CDN: URL cycling via `fonts.gstatic.com` |
| `src/plugins/github.js` | 73 | GitHub/Fastly CDN: Range requests with URL fallback |
| `src/plugins/jsdelivr.js` | 43 | jsDelivr CDN: URL cycling |
| `src/plugins/bunny-cdn.js` | 45 | Bunny CDN: URL cycling via `fonts.bunny.net` |
| `css/main.css` | — | WCAG 2.2 AA styles, dark mode, reduced-motion support |
| `index.html` | — | Single HTML entry point, semantic markup |
