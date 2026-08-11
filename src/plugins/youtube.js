/**
 * YouTube / Google CDN speed test plugin.
 *
 * Downloads large CJK font files from fonts.gstatic.com (Google Fonts CDN).
 * Each font file is 5–10 MB — large enough for meaningful throughput
 * measurement on high-speed connections.
 *
 * The YouTube video CDN (googlevideo.com) is CORS-blocked from browser
 * JavaScript, so this plugin uses Google Fonts CDN edge servers — the
 * same Google global CDN infrastructure — as a practical alternative.
 *
 * @module plugins/youtube
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import {
    createBuildResult, createUrlBasedRunLoop, downloadFullFile,
} from '../lib/plugin-runner.js';

/**
 * Large CJK font files (TTF) from fonts.gstatic.com.
 * Each is 5–10 MB and supports CORS + Timing-Allow-Origin. Multiple
 * URLs spread cache pressure across different CDN edge locations.
 */
const GSTATIC_FONT_URLS = [
    'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf',
    'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGzjCnYw.ttf',
    'https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf',
    'https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk75s.ttf',
    'https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLQ.ttf',
    'https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzg01eLQ.ttf',
];

const buildResult = createBuildResult({
    pluginId: 'youtube',
    targetName: 'YouTube CDN',
    category: 'streaming',
});

const youtubePlugin = {
    id: 'youtube',
    name: 'YouTube CDN',
    description: 'Download speed from Google CDN (fonts.gstatic.com large CJK fonts)',
    category: 'streaming',
    run: createUrlBasedRunLoop({
        buildResult, urls: GSTATIC_FONT_URLS, downloadFn: downloadFullFile,
    }),
};

registerPlugin(youtubePlugin);
export { youtubePlugin };
