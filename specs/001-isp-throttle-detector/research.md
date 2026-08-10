# Research: ISP Throttle Detector

**Date**: 2026-08-10 | **Feature**: ISP Throttle Detector

## 1. CORS Compatibility Research for Test Targets

### 1.1 fast.com (Netflix CDN)

**How fast.com works**:
1. Load `https://fast.com/` → HTML page with inline `<script>` tag pointing to `app.js` bundle
2. The `app.js` JavaScript bundle contains an embedded app token
3. Call `https://api.fast.com/netflix/speedtest/v2?https=true&token=<TOKEN>&urlCount=5` to get a list of OCA (Open Connect Appliance) URLs
4. Download 25MB files from Netflix's OCA servers using the returned URLs

**Token extraction approach**: Multiple open-source projects (`fast-speedtest-api`, `fast.com` npm package, `netflix-fast-cli`) extract the token by:
1. Fetching the fast.com HTML page
2. Parsing the `<script src="...">` tag to get the app.js URL
3. Fetching app.js and using regex to find the token pattern
4. The token rotates — it's embedded at page load time

**CORS status for OCA downloads**:
- OCA URLs point to Netflix CDN edge servers (e.g., `https://ipv4-c066-lax009-ix.1.oca.nflxvideo.net/speedtest/range/0-0?...`)
- These are cross-origin from any non-Netflix domain
- They may or may not send `Timing-Allow-Origin` headers
- `fetch()` should work for the download (Netflix designed fast.com to work in browsers), but Resource Timing `transferSize` may be 0 without `Timing-Allow-Origin`
- **Key finding**: The `responseEnd` and `fetchStart` Performance API properties ARE available cross-origin even without `Timing-Allow-Origin` (per MDN). This means we can measure `duration` for timing even if `transferSize` is inaccessible.

**Verdict**: **VIABLE** with limitations. Token extraction is fragile but has precedent. Speed measurement uses `performance.now()` timing + `responseEnd - fetchStart` for cross-origin duration. If `transferSize` is unavailable, we use `encodedBodySize` or the requested byte count as an estimate.

### 1.2 Speedtest.net (Ookla)

- Ookla provides an `@ookla/speedtest-js-sdk` npm package but it **requires a paid license** (license.inquire@ookla.com)
- No public API exists for free use
- CORS is blocked on their public endpoints
- The old `speedtest.net/csv.php` endpoint returns CSV but is CORS-restricted

**Verdict**: **NOT VIABLE** for an open-source, zero-cost project.

### 1.3 LibreSpeed

- Open-source self-hosted speed test: PHP backend required (also Go, Node experimental)
- Public demo at `https://librespeed.org/` with multiple worldwide servers
- Supports `cors=true` parameter which makes backend send `Access-Control-Allow-Origin: *`
- Server list available programmatically via `server-list.json`
- **Constraint**: Requires self-hosting a backend for production use. Using the public demo is possible but fragile — it's not designed as a public API and the maintainer has explicitly asked people not to use demo servers for their applications (Issue #261: "please don't use the demo servers, they can't handle much traffic").

**Verdict**: **VIABLE but not recommended**. Using public demo servers is against maintainer guidance. Self-hosting requires a PHP server — violates the client-side-only principle. The Cloudflare endpoint is a superior alternative that requires no backend.

### 1.4 Cloudflare Speed Test

- Public endpoint: `https://speed.cloudflare.com/__down?bytes=N`
- Designed for programmatic access (used by `@cloudflare/speedtest` npm package)
- Sends proper CORS headers (`Access-Control-Allow-Origin: *`)
- Sends `Timing-Allow-Origin` headers — full Resource Timing data available
- Supports query parameter `bytes` for variable payload sizes (0 to ~250MB)
- Cloudflare's edge network is globally distributed with points of presence in 330+ cities
- The endpoint also supports `Server-Timing` headers for subtracting server processing time

**Verdict**: **FULLY VIABLE**. Best option for the baseline test. Proper CORS, Timing-Allow-Origin, designed for this exact use case, no backend hosting needed.

### 1.5 Google CDN

**Option A: Google Cloud Storage public buckets**
- Requires CORS configuration on the bucket: `gsutil cors set cors.json gs://BUCKET`
- URL format `https://BUCKET.storage.googleapis.com/OBJECT` (not `storage.googleapis.com/BUCKET/OBJECT` — that variant doesn't support CORS)
- Public buckets can be accessed without authentication
- **Problem**: We don't control a public Google Cloud Storage bucket with CORS configured

**Option B: www.gstatic.com**
- Google's static content CDN for fonts, images, etc.
- Example: `https://www.gstatic.com/` hosts various resources
- CORS headers vary by resource type
- Resources tend to be small (<1MB), limiting speed test accuracy

**Option C: Google Fonts or Google Hosted Libraries**
- Google Fonts API sends CORS headers for font files
- Font files are small (typically <500KB) — insufficient for speed testing
- Google Hosted Libraries (ajax.googleapis.com) hosts JavaScript libraries — but these are also small

**Option D: new Image() fallback to a known Google CDN image**
- Load a large image from a publicly accessible Google CDN URL
- Use `responseEnd - fetchStart` for cross-origin timing (available without Timing-Allow-Origin)
- Cannot use `transferSize` — but we can use `decodedBodySize` or known image file size
- This approach is lossy but works as a CORS fallback

**Verdict**: **VIABLE with caveats**. The manufactured test will use a multi-strategy approach:
1. Try `fetch()` against a known public Google CDN resource
2. Fall back to `new Image()` + Performance API timing
3. If both fail, report error

### 1.6 jsDelivr CDN

- Public CDN for npm packages, GitHub repos, and WordPress
- URL format: `https://cdn.jsdelivr.net/npm/PACKAGE@VERSION/FILE`
- **Sends `Access-Control-Allow-Origin: *` on all resources** — full CORS support
- Many large packages available (e.g., `three.js` minified bundle = ~600KB, larger packages available)
- Globally distributed CDN with multiple providers (Cloudflare, Fastly, etc.)
- Free for open-source, no API key required

**Verdict**: **FULLY VIABLE**. Excellent option for a manufactured CDN test. Proper CORS headers, large files available, reliable CDN.

### 1.7 Summary Table

| Target | CORS Status | Timing-Allow-Origin | fetch() Works | transferSize Available | Overall Viability |
|--------|------------|---------------------|---------------|----------------------|-------------------|
| fast.com (OCA) | Unknown — likely no CORS for 3rd party | Unknown | Likely yes (Netflix serves browsers) | Likely no | ✅ Viable (timing only) |
| Speedtest.net | Blocked | No | ❌ | ❌ | ❌ Not viable (paid) |
| LibreSpeed | Available with `cors=true` parameter | Unknown | ✅ with cors=true | Unknown | ⚠️ Fragile (public demo not API) |
| Cloudflare | ✅ `Access-Control-Allow-Origin: *` | ✅ Yes | ✅ | ✅ | ✅ Best baseline |
| Google CDN | Varies by resource | Unknown | Varies | Varies | ⚠️ Needs fallback |
| jsDelivr | ✅ `Access-Control-Allow-Origin: *` | Likely yes | ✅ | ✅ | ✅ Excellent |

## 2. Web Worker Feasibility for Parallel Test Execution

### 2.1 Browser Support

Web Workers are supported in all modern browsers:
- Chrome 4+ (2010)
- Firefox 3.5+ (2009)
- Safari 4+ (2009)
- Edge 12+ (2015)

**Constitution requirement**: Latest 2 versions of Chrome, Firefox, Safari, Edge — all fully support Web Workers.

### 2.2 Worker Communication Model

```
Main Thread                    Web Worker
    │                              │
    │── postMessage({type:'run',   │
    │    pluginCode, config}) ────►│
    │                              │── execute plugin.run(config)
    │                              │── measure via Performance API
    │                              │── build TestResult
    │◄── postMessage({type:        │
    │    'result', result}) ────── │
    │                              │
    │── (timeout) ────────────────►│── terminate()
```

**AbortSignal proxying**: Since `AbortSignal` cannot be directly transferred to a Worker, we use a `MessageChannel` to proxy abort signals. The main thread sends an abort message over the channel port, and the worker listens on the other port.

**Function serialization**: Plugin `run()` functions are serialized using `.toString()` and sent to the worker. The worker eval's the function string and executes it. This means plugins must be self-contained (no closure captures) — which is architecturally desirable.

### 2.3 Sequential Fallback

When Web Workers are unavailable (older browser, restrictive CSP), the TestRunner falls back to sequential execution on the main thread:

```js
if (typeof Worker === 'undefined') {
  // Sequential fallback
  for (const plugin of plugins) {
    try {
      const result = await plugin.run(config);
      results.push(result);
    } catch (error) {
      results.push(createErrorResult(plugin, error));
    }
  }
}
```

**Impact**: The UI may briefly freeze during each test, but each test is time-bounded by `timeoutMs` (default 30s). A warning is displayed: "Your browser doesn't support parallel testing. Tests will run one at a time, which may take longer."

### 2.4 Performance API in Web Workers

- `PerformanceResourceTiming` is **available in Web Workers** (per MDN)
- `performance.now()` is available in Web Workers
- Workers have their own `performance` object, separate from the main thread
- Resource Timing entries from fetch() calls made inside the worker are observable in the worker

**Verdict**: Web Workers are the correct approach for parallel test execution. They keep the UI responsive and thread-isolate each test's network activity.

## 3. Performance API Measurement Accuracy

### 3.1 Key Timing Properties

| Property | Cross-Origin Available? | What It Measures |
|----------|------------------------|-------------------|
| `fetchStart` | ✅ Yes | Time browser starts fetching resource |
| `responseEnd` | ✅ Yes | Time browser receives last byte of resource |
| `responseStart` | ❌ No (needs Timing-Allow-Origin) | Time browser receives first byte |
| `transferSize` | ❌ No (needs Timing-Allow-Origin) | Total bytes transferred (headers + body) |
| `encodedBodySize` | ❌ No (needs Timing-Allow-Origin) | Compressed body size |
| `decodedBodySize` | ❌ No (needs Timing-Allow-Origin) | Decompressed body size |
| `duration` | ✅ Yes | `responseEnd - startTime` (equivalent to fetch duration) |
| `startTime` | ✅ Yes | Start of the fetch |

**Key Insight**: `responseEnd - fetchStart` gives us the total fetch duration WITHOUT needing Timing-Allow-Origin headers. Combined with known payload size, we can compute throughput:

```js
const duration = entry.responseEnd - entry.fetchStart; // ms
const bytesPerSecond = bytesTransferred / (duration / 1000);
const mbps = (bytesPerSecond * 8) / 1_000_000;
```

When `transferSize` is available (same-origin or Timing-Allow-Origin), we use it for exact byte counts. When not available, we use the known requested payload size.

### 3.2 Accuracy Considerations

1. **Server processing time**: `responseEnd - fetchStart` includes server-side processing time. For large downloads, this is negligible relative to transfer time. Cloudflare's endpoint sends `Server-Timing` headers for subtracting server time.

2. **Connection setup overhead**: `fetchStart` occurs AFTER DNS lookup and TCP connection (those happen before fetch). This means we measure pure transfer time, not connection setup. For speed testing, this is actually desirable — we want to measure throughput, not latency.

3. **TCP slow start**: Initial requests on a new connection are slower due to TCP slow start. Our adaptive payload approach mitigates this:
   - Start with small probe (128KB)
   - Scale up to larger payloads as throughput is measured
   - Use multiple requests per payload size for statistical stability
   - Discard initial "warmup" requests from final calculation

4. **HTTP/2 multiplexing**: Modern browsers use HTTP/2 which multiplexes requests over a single connection. Multiple concurrent requests to the same origin share the connection — this is actually desirable as it more closely mirrors real-world usage (streaming services use persistent connections).

### 3.3 `new Image()` Fallback Measurement

When `fetch()` is CORS-blocked, we load a resource via `new Image()` and measure:

```js
const startTime = performance.now();
const img = new Image();
img.src = url + '?cacheBust=' + Date.now();
img.onload = () => {
  const endTime = performance.now();
  const duration = endTime - startTime;
  // Access PerformanceResourceTiming for more precise timing
  const entries = performance.getEntriesByName(img.src);
  if (entries.length > 0) {
    const entry = entries[0];
    const fetchDuration = entry.responseEnd - entry.fetchStart;
    const bytes = entry.decodedBodySize || entry.encodedBodySize || knownSize;
    // compute speed
  }
};
```

**Limitations**:
- Cannot control payload size (must use whatever size the target resource is)
- Image decoding time is included in `responseEnd` (negligible for large images)
- Browser may cache the image — requires cache-busting query parameter

## 4. Time-Based Adaptive Sampling Strategy

**Design Decision (Updated 2026-08-10)**: Replaced byte-cap-based sampling with time-based sampling per product owner directive.

### Rationale

Byte caps create a fundamental tension:
- **Fast connections (>1Gbps)**: A 200MB cap is consumed in ~1.6 seconds — too few samples for statistically meaningful measurement
- **Slow connections (<10Mbps)**: The same cap represents excessive data usage (~160 seconds of downloading) on what's likely a metered connection
- **Time-based sampling auto-scales**: Each test runs for a fixed duration regardless of connection speed, with the number of samples naturally proportional to throughput

### Algorithm

```
Phase 1: Warmup (first 1 second)
  ├─ Download 128KB chunks as fast as possible
  ├─ Discard these samples (TCP slow start, connection warmup)
  └─ Use warmup results to determine initial chunk size for Phase 2

Phase 2: Time-Bounded Sampling (remaining duration of sampleDurationMs)
  ├─ Start with chunk size based on warmup throughput
  ├─ Loop: Download chunk → measure → record sample → increase chunk size
  │  └─ Chunk size adaptation:
  │     ├─ If last sample > 1s to complete → halve chunk size (better granularity)
  │     └─ If last sample < 200ms → double chunk size (reduce overhead)
  ├─ Stop when: elapsed time >= sampleDurationMs
  └─ Collect all Phase 2 samples

Phase 3: Calculation
  ├─ Filter samples: remove top/bottom 10% (outlier rejection)
  ├─ Calculate median of remaining samples
  ├─ Compute average speed from all accepted samples
  └─ If sampleCount < 3 → report with lower confidence flag
```

### Chunk Size Bounds

| Connection Speed (estimated) | Chunk Size Range |
|------------------------------|------------------|
| Slow (<5 Mbps) | 64KB - 512KB |
| Medium (5-50 Mbps) | 256KB - 5MB |
| Fast (50-200 Mbps) | 1MB - 15MB |
| Very Fast (>200 Mbps) | 5MB - 50MB |

### Stop Condition
- Primary: `elapsed time >= sampleDurationMs` (default: 10000ms)
- Safety: `elapsed time >= timeoutMs` (30s — prevents runaway)
- Emergency: If a single download takes > 15s, abort that download and use collected samples

### Benefits Over Byte Cap
- **Fast connections**: More samples collected in 10s (potentially 100+ vs 2-3 with 200MB cap)
- **Slow connections**: Proportional data usage (~5-25MB per test vs 50MB+ with cap)
- **Consistent measurement quality**: Standard deviation improves with more samples
- **Metered connection friendly**: Data usage is a function of speed, not a hard constant

## 5. Technology Alternatives Considered and Rejected

| Alternative | Considered For | Rejected Because |
|------------|----------------|------------------|
| Preact framework | UI rendering | SPA complexity doesn't warrant it — few state changes, simple DOM structure. Vanilla JS is lighter and removes a dependency. |
| TypeScript | Type safety | Adds a build step and compilation. JSDoc annotations provide sufficient documentation for this project size. |
| WebAssembly for speed measurement | Measurement precision | Overkill — Performance API provides microsecond-resolution timing. No meaningful accuracy gain. |
| Service Workers for background testing | Scheduled tests | Out of scope for MVP (per spec constraints). Also adds complexity without user benefit for manual testing. |
| Chart.js for results visualization | Results display | Out of scope — real-time charts during test execution are explicitly excluded. A simple comparison table is sufficient. |
| IndexedDB for history storage | Data persistence | Overkill — localStorage provides sufficient storage (~5MB) for ~50-100 test history entries. Simpler API, fewer edge cases. |
| LibreSpeed public servers | Baseline test | Maintainer explicitly discourages using demo servers for third-party apps. No SLA, no guarantee of availability. Cloudflare is more reliable. |
| Speedtest.net SDK | Baseline test | Requires paid license from Ookla. Not viable for an open-source, zero-cost project. |
