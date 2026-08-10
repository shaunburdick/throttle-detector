# Quickstart: ISP Throttle Detector

**Feature**: ISP Throttle Detector | **Date**: 2026-08-10

## Prerequisites

- Node.js 20+ (for development tooling only — the app itself runs in any modern browser)
- npm 10+
- A modern browser (Chrome, Firefox, Safari, or Edge — latest 2 versions)

## Setup

```bash
# Clone the repository
git clone https://github.com/shaunburdick/throttle-detector.git
cd throttle-detector

# Switch to the feature branch
git checkout 001-isp-throttle-detector

# Install development dependencies (ESLint, Vitest, jsdom)
npm install
```

## Development

### Serve Locally

The application is a static site — you can serve it with any HTTP server:

```bash
# Option 1: Python (simplest, no dependencies)
python3 -m http.server 8000

# Option 2: npx serve (lightweight)
npx serve src

# Option 3: Vite dev server (HMR, if you want hot reloading)
npx vite
```

Then open `http://localhost:8000` in your browser.

> **Note on file:// protocol**: The app can work when opened directly (`file:///path/to/index.html`), but some browser features (CORS, Web Workers with module imports) may behave differently. An HTTP server is recommended.

### Project Structure

```
throttle-detector/
├── index.html             # Entry point
├── src/
│   ├── app.js             # App bootstrap, mode detection
│   ├── lib/               # Core modules
│   │   ├── test-runner.js
│   │   ├── results-analyzer.js
│   │   ├── results-presenter.js
│   │   ├── history-manager.js
│   │   ├── ui-manager.js
│   │   └── utils.js
│   ├── plugins/           # Test target plugins
│   │   ├── plugin-registry.js
│   │   ├── fast-com.js
│   │   ├── cloudflare.js
│   │   ├── google-cdn.js
│   │   └── jsdelivr.js
│   ├── workers/           # Web Worker scripts
│   │   └── test-worker.js
│   └── styles/
│       └── main.css
├── tests/
│   ├── unit/
│   ├── integration/
│   └── contract/
├── test-assets/           # Binary test files (for manufactured tests)
│   ├── 1mb.bin
│   ├── 10mb.bin
│   └── 25mb.bin
└── specs/                 # Spec-driven development artifacts
    └── 001-isp-throttle-detector/
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run specific test files
npx vitest run tests/unit/test-runner.test.js

# Run with coverage
npx vitest run --coverage
```

**Coverage target**: ≥80% line coverage for `lib/` and `plugins/plugin-registry.js`.

## Linting

```bash
# Run linting
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```

ESLint uses `eslint-config-shaunburdick`. **Zero errors, zero warnings** — no suppression comments.

## Key Flows to Validate Manually

### Flow 1: Happy Path — Full Test Run

1. Open `http://localhost:8000`
2. Verify the UI shows the "initial" state: "Run Test" button, empty results area
3. Click "Run Test"
4. Verify progress indicator shows: "Running 4 tests..."
5. Wait for tests to complete (~10-60 seconds)
6. Verify results table appears with all 4 targets
7. Verify each target shows a speed in Mbps or an error
8. Verify the Cloudflare row is marked as "Baseline"
9. Verify discrepancy indicators (green/yellow/red) appear correctly
10. Verify the verdict message appears below the table

### Flow 2: Partial Failure

1. Open devtools and block `fast.com` domain
2. Run the test
3. Verify fast.com row shows error message (not crash)
4. Verify other 3 targets complete normally
5. Verify verdict accounts for partial data

### Flow 3: JSON Mode

1. Navigate to `http://localhost:8000/?format=json`
2. Verify a valid JSON document is displayed (empty results array, `verdict: "no_data"`)
3. In another tab, open the normal UI and run a test
4. Return to the JSON mode tab and refresh
5. Verify the most recent test results appear in the JSON response

### Flow 4: History

1. Run a test
2. Verify the test appears in the history list
3. Close the browser tab
4. Re-open the application
5. Verify the history still shows the previous test
6. Click the history entry
7. Verify the full results from that run are displayed

### Flow 5: Error States

1. **All tests fail**: Disconnect from internet, run test → verify "Unable to determine" message
2. **Web Workers unsupported**: Use an ancient browser or mock → verify sequential fallback notice
3. **localStorage disabled**: In devtools → Application → clear site data, block storage → run test → verify warning banner
4. **Rapid clicks**: Click "Run Test" rapidly → verify button disables, only one run starts

### Flow 6: Accessibility

1. Navigate the entire UI using only keyboard (Tab, Enter, Space)
2. Verify all interactive elements have visible focus indicators
3. Run a screen reader (VoiceOver, NVDA) and verify progress and results are announced
4. Verify color-coded results have text labels (not just color)

## Building for Production

No build step is required — the application is pure static files. To deploy:

```bash
# Copy static files to deployment directory
cp index.html src/ test-assets/ dist/

# Deploy to GitHub Pages (if configured)
git add dist/
git commit -m "Deploy to GitHub Pages"
git push origin main
```

If GitHub Pages is configured to serve from the `main` branch's `/ (root)` or `/docs` folder, ensure `index.html` is at the correct path.

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| "CORS restricted" on fast.com | Token extraction failed | Check network tab — fast.com may have changed their JS bundle. Update token extraction regex in `fast-com.js`. |
| All CDN tests show 0 Mbps | Network offline | Check internet connection. |
| Tests complete too quickly | Payload too small for fast connection | Adaptive payload should scale up — check `adaptivePayload` config. |
| "localStorage is full" | Too many history entries | Clear history or increase `maxHistoryEntries` in `history-manager.js`. |
| Worker errors in console | Plugin code not serializable | Check for closure captures in `run()`. All deps must be defined within function body. |
