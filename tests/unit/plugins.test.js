/**
 * Plugin and plugin-runner tests.
 *
 * Covers:
 * - plugin-runner.js shared helpers (adaptRangeChunkSize, zeroSample,
 *   createBuildResult, downloadFullFile, downloadRange, run loop factories)
 * - cloudflare.js unique helpers (chunkSizes, adjustChunkIndex)
 *
 * After H-1 refactoring, most plugin logic lives in plugin-runner.js.
 *
 * @module tests/unit/plugins.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    adaptRangeChunkSize, zeroSample, createBuildResult,
    downloadFullFile, downloadRange, createUrlBasedRunLoop,
    createRangeBasedRunLoop,
} from '../../src/lib/plugin-runner.js';
import {
    cloudflarePlugin, CHUNK_SIZES, adjustChunkIndex,
} from '../../src/plugins/cloudflare.js';

// ===== Setup =====

const BLOB_BYTES = 1024 * 1024; // 1 MiB
const TEST_TIMEOUT_MS = 5000;

/** Helper to set the global fetch mock */
function setFetch(mockFn) {
    globalThis.fetch = mockFn;
}

/**
 * Creates a mock fetch that returns a successful response.
 *
 * @param {object} [opts]
 * @returns {Function}
 */
function mockFetchOk(opts = {}) {
    const cl = opts.contentLength ?? BLOB_BYTES;
    const blobSize = opts.blobSize ?? cl;
    return vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
            get: (name) => name === 'content-length' ? String(cl) : null,
        },
        blob: vi.fn().mockResolvedValue(
            new Blob([new Uint8Array(blobSize)])
        ),
    });
}

/**
 * Creates a mock fetch for 206 Partial Content Range responses.
 *
 * @param {object} [opts]
 * @returns {Function}
 */
function mockFetchPartial(opts = {}) {
    const blobSize = opts.blobSize ?? BLOB_BYTES;
    return vi.fn().mockResolvedValue({
        ok: false,
        status: 206,
        blob: vi.fn().mockResolvedValue(
            new Blob([new Uint8Array(blobSize)])
        ),
    });
}

/**
 * Creates a mock fetch that rejects (network error).
 *
 * @returns {Function}
 */
function mockFetchError() {
    return vi.fn().mockRejectedValue(new Error('Network error'));
}

// Mock Performance API
let perfNow = 1000000;
function setupPerformanceMock() {
    perfNow = 1000000;
    globalThis.performance = {
        now: vi.fn(() => {
            perfNow += 1; // Increment to simulate time passing
            return perfNow;
        }),
        getEntriesByName: vi.fn(() => []),
    };
}

function mockResourceTiming(url, transferSize) {
    globalThis.performance.getEntriesByName = vi.fn((name) => {
        if (name.startsWith(url.split('?')[0])) {
            return [{ transferSize, encodedBodySize: transferSize }];
        }
        return [];
    });
}

const CATEGORY_CDN = 'cdn';
const CATEGORY_STREAMING = 'streaming';
const SAMPLE_URL = 'https://example.com/test.bin';
const RANGE_URL = 'https://example.com/file.pdf';

beforeEach(() => {
    setFetch(mockFetchOk());
    setupPerformanceMock();
    globalThis.AbortController = AbortController;
    globalThis.setTimeout = setTimeout;
    globalThis.clearTimeout = clearTimeout;
});

// ===== plugin-runner.js tests =====

describe('Plugin Runner (plugin-runner.js)', () => {
    describe('zeroSample', () => {
        it('returns all-zero sample', () => {
            const sample = zeroSample();
            expect(sample.bytes).toBe(0);
            expect(sample.speedMbps).toBe(0);
            expect(sample.durationMs).toBe(0);
        });
    });

    describe('createBuildResult', () => {
        it('returns a function that produces TestResults', () => {
            const build = createBuildResult({
                pluginId: 'test-plugin',
                targetName: 'Test Target',
                category: CATEGORY_CDN,
            });
            const result = build({
                status: 'success',
                speedMbps: 100,
                durationMs: 5000,
                bytesTransferred: 500000,
                errorMessage: null,
            });

            expect(result.targetName).toBe('Test Target');
            expect(result.pluginId).toBe('test-plugin');
            expect(result.category).toBe(CATEGORY_CDN);
            expect(result.status).toBe('success');
            expect(result.downloadSpeedMbps).toBe(100);
            expect(result.durationMs).toBe(5000);
            expect(result.bytesTransferred).toBe(500000);
            expect(result.errorMessage).toBeNull();
            expect(result.timestamp).toBeTruthy();
        });

        it('handles error results with errorMessage', () => {
            const build = createBuildResult({
                pluginId: 'err',
                targetName: 'Error Plugin',
                category: CATEGORY_STREAMING,
            });
            const result = build({
                status: 'error',
                speedMbps: null,
                durationMs: 100,
                bytesTransferred: 0,
                errorMessage: 'CORS blocked',
            });

            expect(result.status).toBe('error');
            expect(result.downloadSpeedMbps).toBeNull();
            expect(result.errorMessage).toBe('CORS blocked');
            expect(result.category).toBe(CATEGORY_STREAMING);
        });
    });

    describe('adaptRangeChunkSize', () => {
        it('returns minChunk when samples array is empty', () => {
            const size = adaptRangeChunkSize([]);
            expect(size).toBe(64 * 1024); // DEFAULT_MIN_CHUNK
        });

        it('returns minChunk for slow connections (< 5 Mbps)', () => {
            const size = adaptRangeChunkSize([1, 2, 3]);
            expect(size).toBe(64 * 1024);
        });

        it('returns midChunk for medium connections (5-50 Mbps)', () => {
            const size = adaptRangeChunkSize([20, 30, 40]);
            expect(size).toBe(512 * 1024);
        });

        it('returns largeChunk for fast connections (50-200 Mbps)', () => {
            const size = adaptRangeChunkSize([100, 150]);
            expect(size).toBe(2 * 1024 * 1024);
        });

        it('returns maxFast for very fast connections (> 200 Mbps)', () => {
            const size = adaptRangeChunkSize([300, 400, 500]);
            expect(size).toBeLessThanOrEqual(25 * 1024 * 1024);
            expect(size).toBeGreaterThan(2 * 1024 * 1024);
        });

        it('accepts custom threshold overrides', () => {
            const size = adaptRangeChunkSize([15], {
                slowThreshold: 10,
                mediumThreshold: 20,
                midChunk: 256 * 1024,
                largeChunk: 1 * 1024 * 1024,
            });
            expect(size).toBe(256 * 1024);
        });
    });

    describe('downloadFullFile', () => {
        it('returns a speed sample from a successful download', async () => {
            setFetch(mockFetchOk({ contentLength: BLOB_BYTES }));
            mockResourceTiming(SAMPLE_URL, BLOB_BYTES);

            const sample = await downloadFullFile({
                url: SAMPLE_URL,
                timeoutMs: TEST_TIMEOUT_MS,
            });

            expect(sample.speedMbps).toBeGreaterThan(0);
            expect(sample.bytes).toBe(BLOB_BYTES);
            expect(sample.durationMs).toBeGreaterThanOrEqual(0);
        });

        it('returns zeroSample when fetch fails', async () => {
            setFetch(mockFetchError());

            const sample = await downloadFullFile({
                url: SAMPLE_URL,
                timeoutMs: TEST_TIMEOUT_MS,
            });

            expect(sample).toEqual(zeroSample());
        });

        it('returns zeroSample when response is not ok', async () => {
            setFetch(
                vi.fn().mockResolvedValue({ ok: false, status: 404 })
            );

            const sample = await downloadFullFile({
                url: SAMPLE_URL,
                timeoutMs: TEST_TIMEOUT_MS,
            });

            expect(sample).toEqual(zeroSample());
        });

        it('adds cache-bust query parameter', async () => {
            const mockFn = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => String(BLOB_BYTES) },
                blob: () => new Blob([new Uint8Array(BLOB_BYTES)]),
            });
            setFetch(mockFn);

            await downloadFullFile({
                url: SAMPLE_URL,
                timeoutMs: TEST_TIMEOUT_MS,
            });

            const fetchedUrl = mockFn.mock.calls[0][0];
            expect(fetchedUrl).toMatch(/[?]_=\d+$/);
        });
    });

    describe('downloadRange', () => {
        it('returns a speed sample from a Range request', async () => {
            setFetch(mockFetchPartial({ blobSize: 128 * 1024 }));

            const sample = await downloadRange({
                url: RANGE_URL,
                chunkBytes: 128 * 1024,
                timeoutMs: TEST_TIMEOUT_MS,
            });

            expect(sample.speedMbps).toBeGreaterThan(0);
            expect(sample.bytes).toBe(128 * 1024);
        });

        it('returns zeroSample on network error', async () => {
            setFetch(mockFetchError());

            const sample = await downloadRange({
                url: RANGE_URL,
                chunkBytes: 65536,
                timeoutMs: TEST_TIMEOUT_MS,
            });

            expect(sample).toEqual(zeroSample());
        });

        it('sends Range header in the request', async () => {
            const mockFn = vi.fn().mockResolvedValue({
                ok: false,
                status: 206,
                blob: () => new Blob([new Uint8Array(65536)]),
            });
            setFetch(mockFn);

            await downloadRange({
                url: RANGE_URL,
                chunkBytes: 65536,
                timeoutMs: TEST_TIMEOUT_MS,
            });

            const reqOpts = mockFn.mock.calls[0][1];
            expect(reqOpts.headers.Range).toBe('bytes=0-65535');
        });
    });

    describe('createUrlBasedRunLoop', () => {
        const cycleUrls = [
            `${SAMPLE_URL}?id=1`,
            `${SAMPLE_URL}?id=2`,
        ];

        it('returns a plugin-compatible run function', async () => {
            setFetch(mockFetchOk({ contentLength: BLOB_BYTES }));
            mockResourceTiming(SAMPLE_URL, BLOB_BYTES);

            const build = createBuildResult({
                pluginId: 'loop-test',
                targetName: 'Loop Test',
                category: CATEGORY_CDN,
            });
            const run = createUrlBasedRunLoop({
                buildResult: build,
                urls: cycleUrls,
                downloadFn: downloadFullFile,
            });

            const result = await run({
                sampleDurationMs: 500,
                timeoutMs: TEST_TIMEOUT_MS,
                adaptivePayload: true,
            });

            expect(result.pluginId).toBe('loop-test');
            expect(['success', 'error']).toContain(result.status);
            expect(result.durationMs).toBeGreaterThan(0);
        });

        it('cycles through URLs', async () => {
            const calls = [];
            const captureDownload = vi.fn(async ({ url }) => {
                calls.push(url);
                return { bytes: 1024, speedMbps: 100, durationMs: 10 };
            });

            const build = createBuildResult({
                pluginId: 'cycle', targetName: 'Cycle',
                category: CATEGORY_CDN,
            });
            const run = createUrlBasedRunLoop({
                buildResult: build,
                urls: cycleUrls,
                downloadFn: captureDownload,
            });

            await run({
                sampleDurationMs: 200,
                timeoutMs: TEST_TIMEOUT_MS,
                adaptivePayload: true,
            });

            expect(calls.length).toBeGreaterThanOrEqual(1);
            expect(calls[0]).toBe(cycleUrls[0]);
        });

        it('returns error status when all samples fail', async () => {
            const failDownload = vi.fn(async () => zeroSample());
            const build = createBuildResult({
                pluginId: 'fail', targetName: 'Fail',
                category: CATEGORY_CDN,
            });
            const run = createUrlBasedRunLoop({
                buildResult: build,
                urls: cycleUrls,
                downloadFn: failDownload,
            });

            const result = await run({
                sampleDurationMs: 500,
                timeoutMs: TEST_TIMEOUT_MS,
                adaptivePayload: true,
            });

            expect(result.status).toBe('error');
            expect(result.errorMessage).toContain('Not enough valid samples');
        });
    });

    describe('createRangeBasedRunLoop', () => {
        it('returns a plugin-compatible run function', async () => {
            setFetch(mockFetchPartial({ blobSize: 65536 }));
            const build = createBuildResult({
                pluginId: 'range-loop',
                targetName: 'Range Loop',
                category: CATEGORY_CDN,
            });
            const resolveUrl = async () => RANGE_URL;
            const run = createRangeBasedRunLoop({
                buildResult: build,
                resolveUrl,
                downloadFn: downloadRange,
                adaptiveFn: adaptRangeChunkSize,
            });

            const result = await run({
                sampleDurationMs: 500,
                timeoutMs: TEST_TIMEOUT_MS,
                adaptivePayload: true,
            });

            expect(result.pluginId).toBe('range-loop');
            expect(['success', 'error']).toContain(result.status);
        });

        it('calls resolveUrl to get the base URL', async () => {
            setFetch(mockFetchPartial({ blobSize: 65536 }));
            const build = createBuildResult({
                pluginId: 'res-test',
                targetName: 'Resolve Test',
                category: CATEGORY_CDN,
            });
            const resolveUrl = vi.fn(
                async () => 'https://example.com/myfile.pdf'
            );
            const run = createRangeBasedRunLoop({
                buildResult: build,
                resolveUrl,
                downloadFn: downloadRange,
                adaptiveFn: adaptRangeChunkSize,
            });

            await run({
                sampleDurationMs: 100,
                timeoutMs: TEST_TIMEOUT_MS,
                adaptivePayload: true,
            });
            expect(resolveUrl).toHaveBeenCalled();
        });
    });
});

// ===== Cloudflare plugin tests =====

describe('Cloudflare Plugin', () => {
    it('has correct plugin metadata', () => {
        expect(cloudflarePlugin.id).toBe('cloudflare');
        expect(cloudflarePlugin.name).toContain('Cloudflare');
        expect(cloudflarePlugin.category).toBe(CATEGORY_CDN);
        expect(typeof cloudflarePlugin.run).toBe('function');
    });

    describe('CHUNK_SIZES', () => {
        it('contains 7 chunk sizes', () => {
            expect(CHUNK_SIZES).toHaveLength(7);
        });

        it('has increasing chunk sizes', () => {
            for (let i = 1; i < CHUNK_SIZES.length; i++) {
                expect(CHUNK_SIZES[i]).toBeGreaterThan(CHUNK_SIZES[i - 1]);
            }
        });

        it('starts at 256 KiB', () => {
            expect(CHUNK_SIZES[0]).toBe(256 * 1024);
        });

        it('ends at 25 MiB', () => {
            expect(CHUNK_SIZES[CHUNK_SIZES.length - 1]).toBe(25 * 1024 * 1024);
        });
    });

    describe('adjustChunkIndex', () => {
        it('decreases index for slow samples (>1000ms)', () => {
            const result = adjustChunkIndex(1500, 3, 6);
            expect(result).toBe(2);
        });

        it('increases index for fast samples (<200ms)', () => {
            const result = adjustChunkIndex(100, 2, 6);
            expect(result).toBe(3);
        });

        it('keeps index the same for normal samples (200-1000ms)', () => {
            const result = adjustChunkIndex(500, 3, 6);
            expect(result).toBe(3);
        });

        it('does not go below 0', () => {
            const result = adjustChunkIndex(1500, 0, 6);
            expect(result).toBe(0);
        });

        it('does not exceed maxIndex', () => {
            const result = adjustChunkIndex(50, 6, 6);
            expect(result).toBe(6);
        });
    });
});
