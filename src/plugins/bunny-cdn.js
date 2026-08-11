/**
 * Bunny CDN speed test plugin.
 *
 * Downloads large CJK font files from fonts.bunny.net (Bunny CDN's
 * first-party font delivery service). Each font file is ~1 MB.
 *
 * @module plugins/bunny-cdn
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import {
    createBuildResult, createUrlBasedRunLoop, downloadFullFile,
} from '../lib/plugin-runner.js';

/**
 * Large CJK font files served from Bunny CDN's fonts.bunny.net edge.
 * Each is 0.5–1.1 MB and supports CORS + Range requests. Multiple
 * URLs spread cache pressure across different CDN nodes.
 */
const BUNNY_FONT_URLS = [
    'https://fonts.bunny.net/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2',
    'https://fonts.bunny.net/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2',
    'https://fonts.bunny.net/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff2',
    'https://fonts.bunny.net/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2',
    'https://fonts.bunny.net/noto-sans-tc/files/noto-sans-tc-chinese-traditional-400-normal.woff2',
];

const buildResult = createBuildResult({
    pluginId: 'bunny-cdn',
    targetName: 'Bunny CDN',
    category: 'cdn',
});

const bunnyCdnPlugin = {
    id: 'bunny-cdn',
    name: 'Bunny CDN',
    description: 'Download speed from Bunny CDN (fonts.bunny.net large CJK fonts)',
    category: 'cdn',
    run: createUrlBasedRunLoop({
        buildResult, urls: BUNNY_FONT_URLS, downloadFn: downloadFullFile,
    }),
};

registerPlugin(bunnyCdnPlugin);
export { bunnyCdnPlugin };
