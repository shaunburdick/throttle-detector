/**
 * GitHub CDN speed test plugin.
 *
 * Downloads a known binary test file from raw.githubusercontent.com
 * (backed by Fastly CDN) using byte-range requests with adaptive chunk
 * sizing. Probes the primary URL and falls back to a secondary if
 * unavailable.
 *
 * @module plugins/github
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import {
    createBuildResult, createRangeBasedRunLoop,
    downloadRange, adaptRangeChunkSize, PER_FETCH_TIMEOUT,
} from '../lib/plugin-runner.js';

const PRIMARY_URL = 'https://raw.githubusercontent.com/shaunburdick/throttle-detector/main/test-assets/25mb.bin';
const FALLBACK_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/r170/build/three.min.js';

/** HTTP 206 — expected for Range requests */
const HTTP_PARTIAL_CONTENT = 206;

const buildResult = createBuildResult({
    pluginId: 'github',
    targetName: 'GitHub (Fastly)',
    category: 'cdn',
});

/**
 * Probes the primary URL with a zero-byte Range request. Falls back to
 * the secondary URL if the probe fails.
 *
 * @returns {Promise<string>}
 */
async function resolveUrl() {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(), PER_FETCH_TIMEOUT
    );
    try {
        const resp = await fetch(`${PRIMARY_URL}?probe=1`, {
            signal: controller.signal,
            cache: 'no-store',
            headers: { Range: 'bytes=0-0' },
        });
        if (!resp.ok && resp.status !== HTTP_PARTIAL_CONTENT) {
            return FALLBACK_URL;
        }
        return PRIMARY_URL;
    } catch {
        return FALLBACK_URL;
    } finally {
        clearTimeout(timeoutId);
    }
}

const githubPlugin = {
    id: 'github',
    name: 'GitHub (Fastly)',
    description: 'Download speed from GitHub raw CDN (raw.githubusercontent.com)',
    category: 'cdn',
    run: createRangeBasedRunLoop({
        buildResult,
        resolveUrl,
        downloadFn: downloadRange,
        adaptiveFn: adaptRangeChunkSize,
    }),
};

registerPlugin(githubPlugin);
export { githubPlugin };
