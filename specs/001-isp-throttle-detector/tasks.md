# Tasks: ISP Throttle Detector

**Input**: Design documents from `/specs/001-isp-throttle-detector/`

**Prerequisites**: plan.md (✅), spec.md (✅), research.md (✅), data-model.md (✅), contracts/ (✅), quickstart.md (✅)

**Organization**: Tasks are grouped by user story for independent implementation and testing, per spec-driven-development methodology.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Includes exact file paths

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, tooling, and basic structure

- [x] T001 Set up project scaffolding: create `index.html`, `src/`, `tests/`, `test-assets/` directory structure per plan.md
- [x] T002 Initialize npm project with `package.json` (name, version, type:module, scripts for test/lint/build)
- [x] T003 [P] Install development dependencies: `vitest`, `jsdom`, `eslint`, `eslint-config-shaunburdick` per style skill
- [x] T004 [P] Configure `.editorconfig` from `@shaunburdick/style` per style skill
- [x] T005 [P] Configure ESLint with `eslint-config-shaunburdick` in `eslint.config.js`
- [x] T006 [P] Configure Vitest in `vite.config.js` with jsdom environment
- [x] T007 [P] Create `index.html` with semantic HTML shell: `<header>`, `<main>`, `<footer>`, `<noscript>` fallback, CSS link, `<script type="module" src="src/app.js">`
- [x] T008 [P] Generate test asset binary files: `test-assets/1mb.bin`, `test-assets/10mb.bin`, `test-assets/25mb.bin` (can use `dd` or Node.js script)
- [x] T009 Run `npm run lint && npm test` to verify clean baseline (no source files yet, should pass on empty)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T010 Create `src/lib/utils.js` with shared utility functions: `formatMbps(speed)`, `formatDuration(ms)`, `formatTimestamp(iso)`, `clamp(value, min, max)`, `median(values)`, `generateRunId()`
- [x] T011 [P] Write unit tests for `src/lib/utils.js` in `tests/unit/utils.test.js` — test all formatting, median, clamp, runId generation
- [x] T012 [P] Create `src/lib/plugin-registry.js` with `registerPlugin()`, `getPlugins()`, `getPlugin()`, `getPluginCount()`, `clearPlugins()` per `contracts/test-module-registration.md`
- [x] T013 [P] Write contract tests for plugin registry in `tests/contract/plugin-interface.test.js` — validate registration, deduplication, clearing
- [x] T014 Create `src/styles/main.css` with CSS Custom Properties for theming: `--color-*`, `--spacing-*`, `--font-*`, base styles, utility classes. Include WCAG 2.2 AA compliant color palette (4.5:1 text contrast, 3:1 large text)

---

## Phase 3: User Story 1 - Run a Differential Speed Test (Priority: P1) 🎯 MVP

**Goal**: User can click "Run Test", watch parallel tests execute with progress, and see results in a comparison table with discrepancy indicators.

**Independent Test**: Open app, click "Run Test", verify all 4 plugins execute, results display with speeds and color-coded discrepancy indicators.

### Tests for User Story 1

- [x] T015 [P] [US1] Create mock test plugin helpers in `tests/helpers/mock-plugin.js` — factory for creating predictable TestPlugin instances (configurable speed, delay, failure mode)
- [x] T016 [P] [US1] Write unit tests for `src/lib/test-runner.js` in `tests/unit/test-runner.test.js` — test plugin loading, parallel execution, result collection, timeout handling, error isolation
- [x] T017 [P] [US1] Write unit tests for `src/lib/results-analyzer.js` in `tests/unit/results-analyzer.test.js` — test baseline selection, discrepancy calculation, classification thresholds, verdict generation
- [x] T018 [P] [US1] Write integration test for full test flow in `tests/integration/full-flow.test.js` — mock plugins, run through runner+analyzer+presenter, verify output

### Implementation for User Story 1

- [x] T019 [US1] Create `src/lib/test-runner.js` — implements TestRunner: `runAll(plugins, config) → Promise<TestResult[]>`, Web Worker dispatch, abort/timeout, sequential fallback, per `contracts/worker-message-format.md`
- [x] T020 [US1] Create `src/workers/test-worker.js` — Web Worker executor: receives plugin code + config, executes `run()`, posts result/error back, handles abort signal via MessagePort, per `contracts/worker-message-format.md`
- [x] T021 [US1] Create `src/lib/results-analyzer.js` — implements `analyzeResults(results) → { baseline, discrepancies, verdict }`, baseline selection logic, discrepancy calculation, classification thresholds (≤15% normal, 15-30% possible, >30% strong)
- [x] T022 [US1] Create `src/lib/results-presenter.js` — implements `presentHtml(run)`, `presentJson(run)`, generates comparison table with proper `<table>`, `<caption>`, `<thead>`, `<tbody>`, `<th scope>`, color-coded rows with text labels
- [x] T023 [US1] Create `src/lib/ui-manager.js` — UI state machine: `initial → running → complete → error-full`, button enable/disable, progress bar with `role="progressbar"` + aria attributes, ARIA live region for status updates
- [x] T024 [US1] Create `src/plugins/fast-com.js` — fast.com plugin: token extraction (fetch fast.com → parse app.js URL → fetch app.js → extract token → call API → get OCA URLs → parallel download → measure speed), adaptive payload, error handling
- [x] T025 [US1] Create `src/plugins/cloudflare.js` — Cloudflare baseline plugin: download from `speed.cloudflare.com/__down?bytes=N`, adaptive payload sizing, Performance API timing, proper CORS/Timing-Allow-Origin usage
- [x] T026 [US1] Create `src/plugins/google-cdn.js` — Google CDN manufactured test: attempt fetch() first, fall back to `new Image()` + Performance API, adaptive payload
- [x] T027 [US1] Create `src/plugins/jsdelivr.js` — jsDelivr CDN manufactured test: download large npm package file from `cdn.jsdelivr.net`, adaptive payload, full CORS support
- [x] T028 [US1] Create `src/app.js` — entry point: import plugins (triggers registration), detect `?format=json`, initialize UI or JSON mode, wire up "Run Test" button → TestRunner → Analyzer → Presenter pipeline, browser API detection (FR-031)
- [x] T029 [US1] Implement all 10 edge cases from spec: all tests fail, no Web Workers, CORS blocked, very fast connection, very slow connection, missing Performance API, localStorage full, rapid clicks, empty history, JSON mode no data

**Checkpoint**: At this point, User Story 1 is fully functional — a user can run a differential speed test and see results with discrepancy analysis.

---

## Phase 4: User Story 2 - View Test History & Trends (Priority: P2)

**Goal**: User can scroll through saved test history, see timestamped summaries, and click entries to view full results from past runs.

**Independent Test**: Run 2-3 tests, verify history list appears with correct timestamps and summaries, click to view past results.

### Tests for User Story 2

- [x] T030 [P] [US2] Write unit tests for `src/lib/history-manager.js` in `tests/unit/history-manager.test.js` — test persist, load, eviction, serialization, empty state, localStorage unavailable fallback

### Implementation for User Story 2

- [x] T031 [US2] Create `src/lib/history-manager.js` — implements `save(run)`, `loadAll() → HistoryEntry[]`, `getByRunId(id) → HistoryEntry`, `evictOldest()`, `clear()`, localStorage serialization, quota-aware eviction (FR-019), unavailable storage fallback (FR-020)
- [x] T032 [US2] Add history UI to `src/lib/ui-manager.js` — history list in sidebar/below results, scrollable list of entries with timestamp + summary, click handler to display past run, empty state message (FR-034: "No tests run yet")
- [x] T033 [US2] Integrate history persistence into test flow in `src/app.js` — call `historyManager.save()` after each test run completes, load history on app init

**Checkpoint**: User Stories 1 AND 2 both work — tests persist across page reloads, history is browsable.

---

## Phase 5: User Story 3 - JSON Mode (Priority: P3)

**Goal**: Navigate with `?format=json` URL parameter to receive machine-readable JSON instead of the visual dashboard.

**Independent Test**: Navigate to `?format=json`, verify valid JSON schema, run test, verify results in JSON.

### Tests for User Story 3

- [x] T034 [P] [US3] Write integration test for JSON mode in `tests/integration/json-mode.test.js` — test all states: no data, with results, with errors, empty history
- [x] T035 [US3] Implement JSON output in `src/lib/results-presenter.js` — `presentJson(run)` method: serialize TestRun to JSON with schema matching spec (FR-022, FR-023, FR-024), include `results[]`, `lastTestTimestamp`, `baselineName`, `verdict`, `errors[]`
- [x] T036 [US3] Wire JSON mode detection in `src/app.js` — detect `?format=json` before UI init, load from localStorage, call `presenter.presentJson()`, output to `document.body` as `<pre>` or set `document.body.textContent`

**Checkpoint**: User Stories 1, 2, AND 3 all work. JSON mode returns valid schema-conformant JSON.

---

## Phase 6: User Story 4 - Understand Throttling Signals (Priority: P2)

**Goal**: Plain-language verdict with green/yellow/red/gray indicators tells non-technical users whether their ISP is throttling and which services are affected.

**Independent Test**: Run tests producing each verdict level, verify correct message text, color, and service names.

### Implementation for User Story 4

- [x] T037 [US4] Enhance verdict generation in `src/lib/results-analyzer.js` — implement all verdict levels: `no_throttling`, `possible_throttling`, `strong_signal`, `inconclusive`, `no_data`, with affected service names, per US4 acceptance scenarios
- [x] T038 [US4] Update `src/lib/results-presenter.js` — verdict display component with colored indicator (green/yellow/red/gray) AND text label (never color alone, FR-015), affected services list, explanation text
- [x] T039 [US4] Update `src/lib/ui-manager.js` — ARIA live region announcement for verdict: "Tests complete. Strong throttling signal for Fast.com (Netflix)."

**Checkpoint**: All user stories complete. Application delivers full value: test, history, JSON mode, and understandable verdicts.

---

## Phase 7: Accessibility & Polish (Cross-Cutting)

**Purpose**: WCAG 2.2 AA compliance, edge case hardening, final quality passes

- [x] T040 [P] Accessibility audit pass on `index.html` and `src/lib/ui-manager.js` — verify: keyboard navigation (FR-025), visible focus indicators, ARIA live regions (FR-026), progressbar role (FR-027), proper table markup (FR-029), color contrast (FR-028)
- [x] T041 [P] Implement `src/styles/main.css` responsive design — mobile-friendly layout, max-width container, readable on narrow screens
- [x] T042 [P] Add `<noscript>` and unsupported browser messaging in `index.html` — clear message: "JavaScript is required to run speed tests" (noscript), "Your browser doesn't support the needed performance measurement features" (old browser)
- [x] T043 Polish error messages across all plugins — ensure all error cases map to plain-language user messages per spec edge cases
- [x] T044 Final integration test pass — run `tests/integration/full-flow.test.js` and `tests/integration/json-mode.test.js`, verify all acceptance criteria from spec
- [x] T045 Run full lint + test + coverage suite: verify ESLint zero errors/warnings, all tests pass, coverage ≥80% on lib/ and plugin-registry
- [x] T046 Quickstart validation — follow `quickstart.md` exactly, verify all flows work end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational — CORE MVP
- **User Story 2 (Phase 4)**: Depends on User Story 1 (needs TestRun data model from US1)
- **User Story 3 (Phase 5)**: Depends on User Story 1 (needs results-presenter from US1), can parallel with US2
- **User Story 4 (Phase 6)**: Depends on User Story 1 (needs results-analyzer from US1), can parallel with US2/US3
- **Polish (Phase 7)**: Depends on all user stories being complete

### Within Each User Story

- Tests (T015-T018, T030, T034) MUST be written and FAIL before implementation
- Core libraries (runner, analyzer, presenter, ui-manager, history-manager) before `app.js` integration
- Plugins can be developed in parallel with each other
- `app.js` last — it wires everything together

### Parallel Opportunities

- **Phase 1**: T003, T004, T005, T006, T007, T008 all [P] — can run in parallel
- **Phase 2**: T011, T012, T013, T014 all [P] — can run in parallel (within their domain)
- **Phase 3**: T015-T018 (tests) can all run in parallel. T019-T022 (core libs) can run in parallel. T024-T027 (all 4 plugins) can run in parallel. T028 (app.js) must come last.
- **Phase 4-6**: US2 (history), US3 (JSON), US4 (verdict) can be developed in parallel once US1 is complete
- **Phase 7**: T040, T041, T042 all [P] — can run in parallel

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 (core differential speed test)
4. **STOP and VALIDATE**: Run through all US1 acceptance scenarios manually
5. Demo-able: "I can detect ISP throttling"

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 → Core speed test works → **MVP Demo**
3. Add US2 → History persists across sessions → **v1.1 Demo**
4. Add US3 → JSON mode for scripting → **v1.2 Demo**
5. Add US4 → Plain-language verdicts → **v1.3 Demo**
6. Add Phase 7 → Accessibility & Polish → **Release Candidate**

### Task Count Summary

| Phase | Task Range | Count | Parallel Tasks |
|-------|-----------|-------|----------------|
| Phase 1: Setup | T001-T009 | 9 | 6 [P] |
| Phase 2: Foundational | T010-T014 | 5 | 4 [P] |
| Phase 3: US1 | T015-T029 | 15 | 6 [P] |
| Phase 4: US2 | T030-T033 | 4 | 1 [P] |
| Phase 5: US3 | T034-T036 | 3 | 1 [P] |
| Phase 6: US4 | T037-T039 | 3 | 0 |
| Phase 7: Polish | T040-T046 | 7 | 3 [P] |
| **Total** | **T001-T046** | **46** | **21 [P]** |

---

## Notes

- [P] tasks = different files, no dependencies — can execute concurrently
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (TDD)
- Commit after each task or logical group with Conventional Commits format
- Stop at any checkpoint to validate story independently
- Edge cases (T029) span all 10 documented cases from spec — implement incrementally as each piece comes together
- **Time-based sampling**: All plugins use `sampleDurationMs` (default 10s) instead of byte caps. Plugins download chunks of increasing size until duration elapses, then average all samples. See `research.md` §4 for algorithm details. The contracts and data-model have been updated to reflect this change.
