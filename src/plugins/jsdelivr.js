/**
 * jsDelivr CDN speed test plugin.
 *
 * Downloads large npm package files from cdn.jsdelivr.net — the
 * world's largest open-source CDN with CORS + Timing-Allow-Origin
 * headers enabled on all assets.
 *
 * @module plugins/jsdelivr
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import {
    createBuildResult, createUrlBasedRunLoop, downloadFullFile,
} from '../lib/plugin-runner.js';

/**
 * Large npm package assets served by jsDelivr. All have CORS +
 * Timing-Allow-Origin headers. @ffmpeg/core WASM is ~32 MB.
 */
const JSDELIVR_URLS = [
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
];

const buildResult = createBuildResult({
    pluginId: 'jsdelivr',
    targetName: 'jsDelivr CDN',
    category: 'cdn',
});

const jsdelivrPlugin = {
    id: 'jsdelivr',
    name: 'jsDelivr CDN',
    description: 'Download speed from jsDelivr global CDN network',
    category: 'cdn',
    run: createUrlBasedRunLoop({
        buildResult, urls: JSDELIVR_URLS, downloadFn: downloadFullFile,
    }),
};

registerPlugin(jsdelivrPlugin);
export { jsdelivrPlugin };
