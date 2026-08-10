# ISP Throttle Detector

A client-side web application that detects ISP throttling by running differential
speed tests against multiple service origins and comparing the results.

**The problem**: ISPs often throttle specific services (Netflix, YouTube) while
leaving generic speed tests untouched. A connection that shows 200 Mbps on
Speedtest.net might only get 50 Mbps from Netflix's servers -- but a single
speed test will never reveal this.

**How this tool helps**: It runs speed tests against four different service
origins (Cloudflare, Netflix/Fast.com, Google CDN, and jsDelivr CDN) in
parallel, then flags significant discrepancies. A large gap between a
service-specific test and the baseline is a strong signal that your ISP is
selectively throttling that service.

## Quick Start

```bash
# Install dev dependencies (ESLint, Vitest, jsdom)
npm install

# Serve locally on http://localhost:8000
npm start

# Run the test suite (82 tests)
npm test

# Run linting
npm run lint
```

For JSON output, append `?format=json` to the URL:
`http://localhost:8000/?format=json`

## Architecture

The application is a pure static site -- no framework, no build step, no
server-side component. It is designed around a **plugin-based architecture**
where each test target is a self-contained module.

### How It Works

1. **Plugin registration**: Each plugin (test target) self-registers on import
   by calling `registerPlugin()` with its metadata and a `run()` function.
2. **Test runner**: Loads all registered plugins and dispatches each one to a
   dedicated **[Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)**
   for parallel execution. Falls back to sequential main-thread execution if
   Workers are not supported.
3. **Time-based sampling**: Each plugin downloads resources continuously for
   10 seconds (`sampleDurationMs`), measuring throughput via the
   **[Performance API](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API)**
   and
   **[Resource Timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)**.
   Adaptive payload sizing prevents tests from completing too quickly (inaccurate)
   or timing out on slow connections.
4. **Discrepancy analysis**: Results are compared against a baseline (Cloudflare
   by default). Deviations are classified as:
   - **Normal** (<= 15% difference)
   - **Possible throttling** (15-30% slower)
   - **Strong signal** (> 30% slower)
5. **Results display**: A color-coded comparison table with a plain-language
   verdict. Results are persisted to `localStorage` for trend tracking across
   sessions.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Vanilla JavaScript (ES2020+) |
| Modules | Native ES modules (`import`/`export`) |
| Styling | CSS Custom Properties, no preprocessor |
| Parallelism | Web Workers |
| Timing | Performance API + Resource Timing |
| Persistence | localStorage |
| Testing | Vitest + jsdom |
| Linting | ESLint (`eslint-config-shaunburdick`) |

### Project Structure

```
throttle-detector/
├── index.html                  # Entry point
├── css/
│   └── main.css                # All stylesheets
├── src/
│   ├── app.js                  # Bootstrap, mode detection, orchestration
│   ├── lib/                    # Core modules
│   │   ├── types.js            # JSDoc typedefs (TestPlugin, TestResult, etc.)
│   │   ├── plugin-registry.js  # Central plugin registration and discovery
│   │   ├── test-runner.js      # Worker dispatch or sequential fallback
│   │   ├── results-analyzer.js # Discrepancy computation and verdict generation
│   │   ├── results-presenter.js# HTML table and JSON output rendering
│   │   ├── history-manager.js  # localStorage persistence with eviction
│   │   ├── ui-manager.js       # DOM manipulation and state management
│   │   └── utils.js            # Shared helpers (runId, formatting, etc.)
│   ├── plugins/                # Test target modules (self-registering)
│   │   ├── cloudflare.js       # Baseline: Cloudflare speed test CDN
│   │   ├── fast-com.js         # Netflix Open Connect CDN (streaming)
│   │   ├── google-cdn.js       # Google CDN via gstatic images
│   │   └── jsdelivr.js         # jsDelivr global CDN
│   └── workers/
│       └── test-worker.js      # Generic Web Worker executor for plugins
├── tests/
│   ├── unit/                   # Isolated module tests
│   ├── integration/            # End-to-end flow tests
│   ├── contract/               # Plugin interface conformance tests
│   └── helpers/                # Test utilities and fixtures
├── test-assets/                # Static binary files for manufactured tests
│   ├── 1mb.bin
│   ├── 10mb.bin
│   └── 25mb.bin
└── specs/
    └── 001-isp-throttle-detector/  # Spec-driven development artifacts
```

## Plugin Interface

Every test target is a plugin object conforming to the `TestPlugin` interface.
Plugins self-register via `registerPlugin()` on import -- no changes are needed
to the test runner, UI, or result analyzer when adding a new target.

### Required Properties

```typescript
interface TestPlugin {
    id: string;           // Unique kebab-case identifier
    name: string;         // Human-readable display name
    description: string;  // One-line description of what is being measured
    category: 'streaming' | 'cdn' | 'manufactured';
    run(config: TestConfig): Promise<TestResult>;
}

interface TestConfig {
    timeoutMs: number;        // Maximum time (ms) for this plugin (default: 30000)
    sampleDurationMs: number; // Duration (ms) of the sampling phase (default: 10000)
    adaptivePayload: boolean; // Whether to use adaptive chunk sizing
}

interface TestResult {
    targetName: string;         // Display name of the test target
    pluginId: string;           // Matches TestPlugin.id
    status: 'success' | 'error' | 'timeout';
    downloadSpeedMbps: number | null;  // Null on error/timeout
    durationMs: number;         // Total test duration
    bytesTransferred: number;   // Total bytes downloaded
    errorMessage: string | null;// Null on success
    timestamp: string;          // ISO 8601
}
```

### Category Values

| Category | Purpose |
|----------|---------|
| `streaming` | Tests targeting video/streaming infrastructure (e.g. Netflix CDN) |
| `cdn` | Generic CDN speed tests that serve as data points |
| `manufactured` | Tests downloading known resources from CDN origins |

### Adding a New Test Target

Create a new file in `src/plugins/`. The plugin must self-register via
`registerPlugin()`. Here is a minimal example:

```javascript
// src/plugins/example-cdn.js
import { registerPlugin } from '../lib/plugin-registry.js';

const SAMPLE_DURATION_MS = 10000;
const BITS_PER_BYTE = 8;
const BYTES_PER_MILLION = 1_000_000;

const EXAMPLE_URL = 'https://cdn.example.com/speedtest/10mb.bin';

const examplePlugin = {
    id: 'example-cdn',
    name: 'Example CDN',
    description: 'Download speed from Example CDN',
    category: 'cdn',

    async run(config) {
        const startTime = performance.now();
        const sampleDuration = config.sampleDurationMs || SAMPLE_DURATION_MS;
        const timeoutMs = config.timeoutMs || 30000;
        let totalBytes = 0;

        try {
            while (performance.now() - startTime < sampleDuration) {
                if (performance.now() - startTime > timeoutMs) break;

                const url = `${EXAMPLE_URL}?t=${Date.now()}`;
                const t0 = performance.now();
                const response = await fetch(url, { cache: 'no-store' });
                await response.blob();
                const dur = performance.now() - t0;

                // Use Resource Timing for accurate byte counts
                const entries = performance.getEntriesByName(url);
                const bytes = entries.length > 0
                    ? (entries[entries.length - 1].transferSize || 0)
                    : 0;
                totalBytes += bytes;
            }

            const durationMs = Math.round(performance.now() - startTime);
            const bps = totalBytes / (durationMs / 1000);
            const speedMbps = (bps * BITS_PER_BYTE) / BYTES_PER_MILLION;

            return {
                targetName: 'Example CDN',
                pluginId: 'example-cdn',
                status: 'success',
                downloadSpeedMbps: speedMbps,
                durationMs,
                bytesTransferred: totalBytes,
                errorMessage: null,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            return {
                targetName: 'Example CDN',
                pluginId: 'example-cdn',
                status: 'error',
                downloadSpeedMbps: null,
                durationMs: Math.round(performance.now() - startTime),
                bytesTransferred: totalBytes,
                errorMessage: error.message || 'Unknown error',
                timestamp: new Date().toISOString(),
            };
        }
    },
};

registerPlugin(examplePlugin);
export { examplePlugin };
```

Then import your plugin in `src/app.js` alongside the existing ones:

```javascript
import './plugins/example-cdn.js';
```

That is it. Your new target will appear in the next test run with no other
changes required.

## Test Targets (Included)

| Plugin | ID | Category | Test Source |
|--------|----|----------|-------------|
| Cloudflare | `cloudflare` | cdn | `speed.cloudflare.com` CDN (used as baseline) |
| Fast.com | `fast-com` | streaming | Netflix Open Connect CDN |
| Google CDN | `google-cdn` | manufactured | `gstatic.com` image resources |
| jsDelivr CDN | `jsdelivr` | cdn | `cdn.jsdelivr.net` JS libraries |

## Testing and Linting

```bash
# Run all tests
npm test                # vitest run (82 tests across 6 files)

# Watch mode (re-runs on file changes)
npm run test:watch

# Coverage report (target: >=80% line coverage on lib/ and plugin-registry)
npm run test:coverage

# Lint all files
npm run lint            # ESLint — zero errors, zero warnings required

# Auto-fix linting issues
npm run lint:fix
```

**Test organization**:

| Directory | Count | Purpose |
|-----------|-------|---------|
| `tests/unit/` | 62 tests | Isolated tests for `lib/` modules |
| `tests/contract/` | 16 tests | Enforces `TestPlugin` interface contract |
| `tests/integration/` | 4 tests | End-to-end: runner -> analyzer -> presenter |

## Deployment

The application is pure static files. Deploy to GitHub Pages by pushing to the
`main` branch:

1. Ensure `index.html` is at the repository root (or configure Pages to serve
   from a specific folder).
2. Push to `main`.
3. GitHub Pages serves the site at `https://<username>.github.io/throttle-detector/`.

No build step, no CI/CD pipeline required.

## Browser Support

- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)

**Graceful degradation**: If Web Workers are unavailable, tests run sequentially
on the main thread with a notice. If the Performance API is missing, the
application displays an unsupported-browser message. If localStorage is
unavailable or full, results still display for the current session and a
non-blocking warning is shown.

## License

MIT
