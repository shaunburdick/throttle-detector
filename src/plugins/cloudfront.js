/**
 * AWS CloudFront CDN speed test plugin.
 *
 * Downloads a large AWS whitepaper from d1.awsstatic.com (AWS's own
 * public CloudFront distribution) using byte-range requests with
 * adaptive chunk sizing.
 *
 * @module plugins/cloudfront
 */

import { registerPlugin } from '../lib/plugin-registry.js';
import {
    createBuildResult, createRangeBasedRunLoop,
    downloadRange, adaptRangeChunkSize,
} from '../lib/plugin-runner.js';

/** Primary test file served from CloudFront */
const CLOUDFRONT_BASE = 'https://d1.awsstatic.com/whitepapers/aws-overview.pdf';

const buildResult = createBuildResult({
    pluginId: 'cloudfront',
    targetName: 'AWS CloudFront',
    category: 'cdn',
});

/** Resolver: immediately returns the fixed CloudFront URL */
async function resolveUrl() {
    return CLOUDFRONT_BASE;
}

const cloudfrontPlugin = {
    id: 'cloudfront',
    name: 'AWS CloudFront',
    description: 'Download speed from AWS CloudFront CDN (d1.awsstatic.com)',
    category: 'cdn',
    run: createRangeBasedRunLoop({
        buildResult,
        resolveUrl,
        downloadFn: downloadRange,
        adaptiveFn: adaptRangeChunkSize,
    }),
};

registerPlugin(cloudfrontPlugin);
export { cloudfrontPlugin };
