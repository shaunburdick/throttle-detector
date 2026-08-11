import { describe, it, expect } from 'vitest';
import { runAll } from '../../src/lib/test-runner.js';
import { analyzeResults } from '../../src/lib/results-analyzer.js';
import { presentHtml, presentJson } from '../../src/lib/results-presenter.js';
import { generateRunId } from '../../src/lib/utils.js';
import { createSuccessPlugin, createErrorPlugin } from '../helpers/mock-plugin.js';

const DEFAULT_CONFIG = {
    timeoutMs: 5000,
    sampleDurationMs: 2000,
    adaptivePayload: true,
};

const CLOUDFLARE_ID = 'cloudflare';
const YOUTUBE_ID = 'youtube';
const CLOUDFRONT_ID = 'cloudfront';
const CORS_ERROR = 'CORS blocked';

describe('Full Test Flow (Integration)', () => {
    it('end-to-end: runner to analyzer to presenter (HTML)', async () => {
        const plugins = [
            createSuccessPlugin(
                { id: CLOUDFLARE_ID, name: 'Cloudflare', speedMbps: 200 }
            ),
            createSuccessPlugin(
                { id: YOUTUBE_ID, name: 'YouTube', speedMbps: 80 }
            ),
            createSuccessPlugin(
                { id: CLOUDFRONT_ID, name: 'CloudFront', speedMbps: 180 }
            ),
            createSuccessPlugin(
                { id: 'jsdelivr', name: 'jsDelivr', speedMbps: 190 }
            ),
        ];

        const results = await runAll({ plugins, config: DEFAULT_CONFIG });
        expect(results).toHaveLength(4);

        const { baseline, discrepancies, verdict } = analyzeResults(results);
        expect(baseline).not.toBeNull();
        expect(baseline.pluginId).toBe(CLOUDFLARE_ID);
        expect(discrepancies).toHaveLength(3);

        const youtubeDisc = discrepancies.find(
            (disc) => disc.pluginId === YOUTUBE_ID
        );
        expect(youtubeDisc.classification).toBe('strong_signal');

        const testRun = {
            runId: generateRunId(),
            timestamp: new Date().toISOString(),
            results,
            baselinePluginId: baseline.pluginId,
            discrepancies,
            verdict,
            warnings: [],
        };

        const html = presentHtml(testRun);
        expect(html).toContain('Cloudflare');
        expect(html).toContain('YouTube');
        expect(html).toContain('Speed Test Results');
        expect(html).toContain('Strong Throttling Signal');

        const json = presentJson(testRun);
        const parsed = JSON.parse(json);
        expect(parsed.results).toHaveLength(4);
        expect(parsed.verdict.level).toBe('strong_signal');
    });

    it('end-to-end: partial failures still produce valid output', async () => {
        const plugins = [
            createSuccessPlugin(
                { id: CLOUDFLARE_ID, name: 'Cloudflare', speedMbps: 100 }
            ),
            createErrorPlugin(
                { id: YOUTUBE_ID, name: 'YouTube', errorMessage: CORS_ERROR }
            ),
            createSuccessPlugin(
                { id: CLOUDFRONT_ID, name: 'CloudFront', speedMbps: 90 }
            ),
        ];

        const results = await runAll({ plugins, config: DEFAULT_CONFIG });
        expect(results).toHaveLength(3);

        const { verdict } = analyzeResults(results);
        const validLevels = [
            'no_throttling', 'possible_throttling',
            'strong_signal', 'inconclusive',
        ];
        expect(validLevels).toContain(verdict.level);

        const testRun = {
            runId: generateRunId(),
            timestamp: new Date().toISOString(),
            results,
            baselinePluginId: CLOUDFLARE_ID,
            discrepancies: [],
            verdict,
            warnings: [],
        };

        const html = presentHtml(testRun);
        expect(html).toContain('Error');
    });

    it('JSON mode returns valid schema for all states', () => {
        const emptyJson = presentJson(null);
        const emptyParsed = JSON.parse(emptyJson);
        expect(emptyParsed.results).toEqual([]);
        expect(emptyParsed.lastTestTimestamp).toBeNull();
        expect(emptyParsed.verdict.level).toBe('no_data');

        const fullRun = {
            runId: generateRunId(),
            timestamp: new Date().toISOString(),
            results: [{
                targetName: 'Test',
                pluginId: 'test',
                status: 'success',
                downloadSpeedMbps: 100,
                durationMs: 1000,
                bytesTransferred: 1024,
                errorMessage: null,
                timestamp: new Date().toISOString(),
            }],
            baselinePluginId: 'test',
            discrepancies: [{
                targetName: 'Other',
                pluginId: 'other',
                percentageDeviation: -20,
                direction: 'slower',
                isSignificant: true,
                classification: 'possible_throttling',
            }],
            verdict: {
                level: 'possible_throttling',
                message: 'Possible throttling on Other',
                affectedServices: ['Other'],
                indicator: 'yellow',
            },
            warnings: [],
        };

        const json = presentJson(fullRun);
        const parsed = JSON.parse(json);
        expect(parsed.results).toHaveLength(1);
        expect(parsed.verdict.level).toBe('possible_throttling');
        expect(parsed.errors).toHaveLength(0);
    });

    it('JSON mode includes errors array for failures', () => {
        const run = {
            runId: generateRunId(),
            timestamp: new Date().toISOString(),
            results: [{
                targetName: 'Fail',
                pluginId: 'fail',
                status: 'error',
                downloadSpeedMbps: null,
                durationMs: 100,
                bytesTransferred: 0,
                errorMessage: CORS_ERROR,
                timestamp: new Date().toISOString(),
            }],
            baselinePluginId: null,
            discrepancies: [],
            verdict: {
                level: 'inconclusive',
                message: 'Unable to determine',
                affectedServices: [],
                indicator: 'gray',
            },
            warnings: [],
        };

        const json = presentJson(run);
        const parsed = JSON.parse(json);
        expect(parsed.errors).toHaveLength(1);
        expect(parsed.errors[0].errorMessage).toBe(CORS_ERROR);
    });
});
