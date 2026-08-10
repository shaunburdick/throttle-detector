<!--
   Sync Impact Report
   ==================
   Version change: 1.0.0 → 1.1.0 (amendment: time-based sampling)
   Modified principles: Technical Decision table — replaced maxPayloadBytes with sampleDurationMs;
     FR-011 reference updated to reflect time-based sampling
   Added sections: None
   Removed sections: None
   Follow-up TODOs: None
 -->

# ISP Throttle Detector Constitution

> Version: 1.1.0 | Ratified: 2026-08-10 | Last Amended: 2026-08-10

## Core Principles

### I. Client-Side Only

This application runs entirely in the browser. There is no server-side component, no backend API,
no database — only static files served from a CDN or GitHub Pages. All data persistence uses
browser-local storage (localStorage or IndexedDB). Any external network requests are exclusively
for running speed tests against public CDN endpoints; the application never phones home or
collects user data.

**Rationale**: Keeps deployment trivial (static hosting), eliminates server costs, preserves user
privacy, and aligns with the project's mission as a personal diagnostic tool.

### II. Plugin Architecture

Every test target is a self-contained module that conforms to a common interface. Adding a new
service (e.g., Hulu, Prime Video) MUST require only dropping in a new module — no changes to
core orchestration logic. The interface contract defines what each plugin provides (metadata)
and what it returns (a standardized result object).

**Rationale**: The throttling landscape evolves as ISPs change practices and new services
emerge. A plugin architecture ensures the tool stays relevant without constant refactoring.

### III. Accessibility-First UI

The user interface MUST meet WCAG 2.2 Level AA standards. This includes proper semantic HTML,
ARIA labels where needed, keyboard navigability, sufficient color contrast (including in
color-coded results), screen-reader-friendly status announcements for test progress and results,
and a focus order that follows the visual layout. Color alone MUST NOT convey information.

**Rationale**: Network performance affects everyone. The tool should be usable by all,
including users relying on assistive technologies.

### IV. Dual-Mode Output

The application MUST support two output modes from a single codebase: an interactive visual
dashboard (the default experience) and a machine-readable JSON mode triggered by the
`?format=json` URL parameter. Both modes must return the same underlying data — the difference
is presentation only.

**Rationale**: A visual dashboard serves casual users investigating their connection. JSON
output enables scripting, monitoring, and integration with other tools — use cases the project
explicitly targets.

### V. Lightweight & Minimal Dependencies

The application MUST be built with vanilla JavaScript and CSS unless SPA complexity genuinely
demands a lightweight framework (Preact is the only permitted alternative). Total page weight
(uncompressed) MUST stay under 200KB. No build step is required for deployment, though a build
step is permitted if it outputs pure static files. External library dependencies are limited to
what can be justified: zero runtime dependencies unless a clear need exists.

**Rationale**: The tool is a diagnostic utility, not a web application. It should load
instantly, work on slow connections (the very thing it's testing), and require no installation
or build tooling for someone to fork and modify it.

### VI. Graceful Degradation

Every test module MUST handle its own errors — timeouts, CORS rejections, network failures,
rate limiting — without crashing the test runner or the UI. Partial results (some tests passed,
some failed) are valid results. The application MUST inform the user which tests failed and why
in plain language. No uncaught exceptions or white screens.

**Rationale**: Network testing is inherently unreliable. The tool must never make the user's
situation worse or leave them guessing about what went wrong.

## Technical Decisions

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Language | JavaScript (ES2020+) | Universal browser support; no transpilation required |
| Framework | Vanilla JS; Preact permitted only if SPA complexity demands it | Keeps payload small; Preact is ~3KB and API-compatible with React |
| Styling | Plain CSS with CSS Custom Properties (variables) | No preprocessor dependency; variables enable theming and reduce repetition |
| Speed measurement | Performance API (`performance.now()`, Resource Timing `transferSize`/`duration`) | Built into all modern browsers; no library needed |
| Concurrency | Web Workers for parallel test execution | Prevents UI blocking during speed tests; Web Workers are universally supported |
| CORS workarounds | `new Image()` timing via Performance API as fallback | Some CDNs don't allow `fetch()` but will serve `<img>` resources |
| Storage | localStorage for test history | Zero-setup persistence; sufficient for the small volume of test result data |
| Deployment | GitHub Pages | Meets the static-only constraint; free; built-in CDN |
| Testing | Vitest (or framework-native test runner) + jsdom | Fast, modern, works with ES modules |

## Quality Standards

These are minimum bars — not targets to aim for, but floors to never go below.

- **Linting**: ESLint with `eslint-config-shaunburdick`; zero errors, zero warnings — no
  suppression comments
- **Test coverage**: ≥ 80% line coverage for plugin interface, test runner, and utility code
- **Accessibility**: WCAG 2.2 Level AA compliance; automated checks via axe-core in CI
- **Browser support**: Latest 2 versions of Chrome, Firefox, Safari, Edge
- **Performance budget**: Total page weight < 200KB (uncompressed), Time to Interactive < 2s
  on a 10Mbps connection
- **Commits**: Feature branches only (`###-feature-name`), Conventional Commits format

## Anti-Patterns to Avoid

- ❌ Adding server-side dependencies: This is a client-only project. No Express, no Lambda,
  no database.
- ❌ Rewriting core orchestration to add a new service: New services must plug into the existing
  interface. If the interface doesn't support a needed pattern, update the interface — not the
  orchestration — and do so with backward compatibility.
- ❌ Disabling lint rules: Fix the code, not the linter.
- ❌ Using color as the sole indicator of meaning: Every color-coded result must also have a
  text label or icon.
- ❌ Blocking the main thread during speed tests: All tests MUST run in Web Workers or
  equivalent off-main-thread mechanisms.
- ❌ Assuming `fetch()` always works: Every network call must have a CORS fallback strategy.
- ❌ Using hard byte caps for test duration control: Tests MUST use time-based sampling
  (`sampleDurationMs`) rather than byte-count limits, ensuring consistent accuracy across
  connection speeds while remaining respectful of metered connections.

## Governance

This constitution supersedes all other project practices. Every feature specification must
reference and align with it. When a requirement conflicts with the constitution, the conflict
must be resolved explicitly — either by adjusting the requirement or by amending the
constitution, but never by silently ignoring either.

**Amendment Process**:
1. Propose the change with rationale and impact analysis
2. Document how existing features are affected
3. Get explicit approval from the product owner
4. Record the amendment in the log below
5. Bump the version number following semantic versioning rules:
   - MAJOR: Principle removal or redefinition
   - MINOR: New principle or section added
   - PATCH: Clarifications, wording fixes

**Compliance**: All PRs must verify constitution alignment. Any deviation must be documented
with justification in the PR description.

## Amendment Log

| Date | Version | Change | Rationale |
|------|---------|--------|-----------|
| 2026-08-10 | 1.0.0 | Initial ratification | Project inception |
| 2026-08-10 | 1.1.0 | Time-based sampling replaces byte cap | Byte caps cause under-sampling on fast connections (>1Gbps) and over-consume data on slow connections. Time-based sampling with adaptive payloads auto-scales: each test runs for `sampleDurationMs` (~8-10s), repeatedly downloading chunks of increasing size, then averages all samples for final speed. More accurate, more respectful of metered connections. |
