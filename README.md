# ISP Throttle Detector

A client-side web application that detects ISP throttling by running differential
speed tests against multiple service origins and comparing the results.

**The problem**: ISPs often throttle specific services (Netflix, YouTube) while
leaving generic speed tests untouched. A connection that shows 200 Mbps on
Speedtest.net might only get 50 Mbps from Netflix's servers -- but a single
speed test will never reveal this.

**How this tool helps**: It runs speed tests against six different service
origins (Cloudflare, AWS CloudFront, YouTube CDN, GitHub/Fastly,
jsDelivr CDN, and Bunny CDN) sequentially, then flags significant
discrepancies. A large gap between a service-specific test and the
baseline is a strong signal that your ISP is selectively throttling
that service.

## Quick Start

```bash
# Install dev dependencies (ESLint, Vitest, jsdom)
npm install

# Serve locally on http://localhost:8000
npm start

# Run the test suite (172 tests)
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
2. **Test runner**: Loads all registered plugins and executes each one sequentially
   on the main thread with `Promise.race()` timeout guards. Sequential execution
   ensures each plugin gets full access to the network pipe, producing accurate
   measurements (parallel execution was found to cause false-positive throttling
   by splitting bandwidth across plugins).
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
| Parallelism | Sequential main-thread with `Promise.race()` timeout guards |
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
│   │   ├── plugin-runner.js    # Shared download primitives and run loop factories
│   │   ├── test-runner.js      # Sequential dispatch with Promise.race() guards
│   │   ├── results-analyzer.js # Discrepancy computation and verdict generation
│   │   ├── results-presenter.js# HTML table and JSON output rendering
│   │   ├── history-manager.js  # localStorage persistence with eviction
│   │   ├── ui-manager.js       # DOM manipulation and state management
│   │   └── utils.js            # Shared helpers (runId, formatting, etc.)
│   ├── plugins/                # Test target modules (self-registering)
│   │   ├── cloudflare.js       # Baseline: Cloudflare speed test CDN
│   │   ├── cloudfront.js       # AWS CloudFront CDN (adaptive Range requests)
│   │   ├── youtube.js          # Google CDN via fonts.gstatic.com
│   │   ├── github.js           # GitHub raw CDN (Fastly, Range requests)
│   │   ├── jsdelivr.js         # jsDelivr global CDN
│   │   └── bunny-cdn.js        # Bunny CDN font delivery service
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
    category: 'streaming' | 'cdn' | 'manufactured';
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

Create a new file in `src/plugins/`. Use the shared helpers from
`plugin-runner.js` — the `createBuildResult` factory and a run loop
factory handle all the boilerplate:

```javascript
// src/plugins/example-cdn.js
import { registerPlugin } from '../lib/plugin-registry.js';
import {
    createBuildResult, createUrlBasedRunLoop, downloadFullFile,
} from '../lib/plugin-runner.js';

const EXAMPLE_URLS = [
    'https://cdn.example.com/speedtest/file1.bin',
    'https://cdn.example.com/speedtest/file2.bin',
];

const buildResult = createBuildResult({
    pluginId: 'example-cdn',
    targetName: 'Example CDN',
    category: 'cdn',
});

const examplePlugin = {
    id: 'example-cdn',
    name: 'Example CDN',
    description: 'Download speed from Example CDN',
    category: 'cdn',
    run: createUrlBasedRunLoop({
        buildResult, urls: EXAMPLE_URLS, downloadFn: downloadFullFile,
    }),
};

registerPlugin(examplePlugin);
export { examplePlugin };
```

Then import your plugin in `src/app.js` alongside the existing ones:

```javascript
import './plugins/example-cdn.js';
```

That is it. Your new target will appear in the next test run with no other
changes required. For Range-request-based plugins (like CloudFront or GitHub),
use `createRangeBasedRunLoop` with `downloadRange` and `adaptRangeChunkSize`
instead.

## Test Targets (Included)

| Plugin | ID | Category | Test Source |
|--------|----|----------|-------------|
| Cloudflare | `cloudflare` | cdn | `speed.cloudflare.com` CDN (used as baseline) |
| AWS CloudFront | `cloudfront` | cdn | `d1.awsstatic.com` whitepaper (Range requests) |
| YouTube CDN | `youtube` | streaming | `fonts.gstatic.com` large CJK fonts |
| GitHub (Fastly) | `github` | cdn | `raw.githubusercontent.com` test asset (Range requests) |
| jsDelivr CDN | `jsdelivr` | cdn | `cdn.jsdelivr.net` npm packages |
| Bunny CDN | `bunny-cdn` | cdn | `fonts.bunny.net` large CJK fonts |

## Testing and Linting

```bash
# Run all tests
npm test                # vitest run (172 tests across 8 files)

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
| `tests/unit/` | 137 tests | Isolated tests for `lib/` modules and plugins |
| `tests/contract/` | 16 tests | Enforces `TestPlugin` interface contract |
| `tests/integration/` | 4 tests | End-to-end: runner → analyzer → presenter |
| `tests/helpers/` | — | Test utilities and fixtures |

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

**Graceful degradation**: The application does not require Web Workers — all
tests run sequentially on the main thread by design. If the Performance API is
missing, the application displays an unsupported-browser message. If localStorage
is unavailable or full, results still display for the current session and a
non-blocking warning is shown.

## License

MIT
