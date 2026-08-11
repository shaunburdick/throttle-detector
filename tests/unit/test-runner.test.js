import { describe, it, expect } from 'vitest';
import { runAll } from '../../src/lib/test-runner.js';
import {
    createSuccessPlugin,
    createErrorPlugin,
    createThrowingPlugin,
} from '../helpers/mock-plugin.js';

const DEFAULT_CONFIG = {
    timeoutMs: 5000,
    sampleDurationMs: 2000,
    adaptivePayload: true,
};

describe('Test Runner', () => {
    describe('runAll', () => {
        it('runs all plugins and returns results', async () => {
            const plugins = [
                createSuccessPlugin({ id: 'p1', speedMbps: 50 }),
                createSuccessPlugin({ id: 'p2', speedMbps: 100 }),
            ];
            const results = await runAll(plugins, DEFAULT_CONFIG);
            expect(results).toHaveLength(2);
            for (const result of results) {
                expect(result.status).toBe('success');
                expect(typeof result.downloadSpeedMbps).toBe('number');
            }
        });

        it('handles mixed success and error plugins', async () => {
            const plugins = [
                createSuccessPlugin({ id: 'ok', speedMbps: 50 }),
                createErrorPlugin({ id: 'fail', errorMessage: 'Test failed' }),
            ];
            const results = await runAll(plugins, DEFAULT_CONFIG);
            expect(results).toHaveLength(2);
            const succeeded = results.filter(
                (res) => res.status === 'success'
            );
            const failed = results.filter((res) => res.status === 'error');
            expect(succeeded).toHaveLength(1);
            expect(failed).toHaveLength(1);
        });

        it('isolates errors — one plugin failure does not crash others', async () => {
            const plugins = [
                createSuccessPlugin({ id: 'ok', speedMbps: 100 }),
                createThrowingPlugin({ id: 'crash' }),
                createSuccessPlugin({ id: 'also-ok', speedMbps: 50 }),
            ];
            const results = await runAll(plugins, DEFAULT_CONFIG);
            expect(results).toHaveLength(3);
            const succeeded = results.filter(
                (res) => res.status === 'success'
            );
            expect(succeeded).toHaveLength(2);
        });

        it('handles empty plugins array', async () => {
            const results = await runAll([], DEFAULT_CONFIG);
            expect(results).toHaveLength(0);
        });

        it('returns proper result shape for all plugins', async () => {
            const plugins = [
                createSuccessPlugin({ id: 'test', speedMbps: 75 }),
            ];
            const results = await runAll(plugins, DEFAULT_CONFIG);
            const result = results[0];

            expect(result.targetName).toBeTruthy();
            expect(result.pluginId).toBe('test');
            expect(['success', 'error', 'timeout']).toContain(result.status);
            expect(typeof result.durationMs).toBe('number');
            expect(typeof result.bytesTransferred).toBe('number');
            expect(result.timestamp).toBeTruthy();
        });

        it('calls onProgress after each plugin with correct (done, total)', async () => {
            const plugins = [
                createSuccessPlugin({ id: 'a', speedMbps: 10, delayMs: 10 }),
                createSuccessPlugin({ id: 'b', speedMbps: 20, delayMs: 10 }),
                createSuccessPlugin({ id: 'c', speedMbps: 30, delayMs: 10 }),
            ];
            const progressCalls = [];
            const results = await runAll(plugins, DEFAULT_CONFIG,
                (done, total) => {
                    progressCalls.push({ done, total });
                });
            expect(results).toHaveLength(3);
            expect(progressCalls).toEqual([
                { done: 1, total: 3 },
                { done: 2, total: 3 },
                { done: 3, total: 3 },
            ]);
        });

        it('does not call onProgress when not provided', async () => {
            const plugins = [
                createSuccessPlugin({ id: 'a', speedMbps: 10 }),
            ];
            // Should not throw — onProgress is optional
            const results = await runAll(plugins, DEFAULT_CONFIG);
            expect(results).toHaveLength(1);
        });

        it('reports progress even when a plugin fails', async () => {
            const plugins = [
                createSuccessPlugin({ id: 'ok', speedMbps: 50 }),
                createErrorPlugin({ id: 'fail', errorMessage: 'boom' }),
                createSuccessPlugin({ id: 'also-ok', speedMbps: 100 }),
            ];
            const progressCalls = [];
            const results = await runAll(plugins, DEFAULT_CONFIG,
                (done, total) => {
                    progressCalls.push({ done, total });
                });
            expect(results).toHaveLength(3);
            expect(progressCalls).toEqual([
                { done: 1, total: 3 },
                { done: 2, total: 3 },
                { done: 3, total: 3 },
            ]);
        });

        it('runs plugins sequentially in registration order', async () => {
            const order = [];
            const plugins = [
                createSuccessPlugin({ id: 'first', speedMbps: 10,
                    delayMs: 20 }),
                createSuccessPlugin({ id: 'second', speedMbps: 20,
                    delayMs: 10 }),
            ];
            // Monkey-patch run to track execution order
            const origFirst = plugins[0].run;
            const origSecond = plugins[1].run;
            plugins[0].run = async (cfg) => {
                order.push('first');
                return origFirst(cfg);
            };
            plugins[1].run = async (cfg) => {
                order.push('second');
                return origSecond(cfg);
            };
            const results = await runAll(plugins, DEFAULT_CONFIG);
            expect(results).toHaveLength(2);
            // Sequential means first finishes before second starts
            expect(order).toEqual(['first', 'second']);
        });
    });
});
