# Contract: Web Worker Message Format

**Version**: 1.0.0 | **Feature**: ISP Throttle Detector

This contract defines the message protocol between the main thread (TestRunner) and Web Workers (plugin executors). All communication uses the `postMessage` API with structured clone-compatible data.

## Worker Creation

```js
// Main thread → creates one worker per plugin
const worker = new Worker('workers/test-worker.js');
```

The worker script (`test-worker.js`) is a thin executor that receives plugin code and config, executes the plugin's `run()` function, and posts results back.

## Message Types

### 1. `run` — Main Thread → Worker

Initiates a test execution in the worker.

```js
worker.postMessage({
  type: 'run',
  pluginId: 'fast-com',           // string — plugin identifier
  pluginName: 'Fast.com (Netflix)',// string — display name (used in error messages)
  pluginCategory: 'streaming',     // string — one of 'streaming'|'cdn'|'manufactured'
  pluginRunCode: '(async function(config) { ... })', 
                                   // string — serialized run() function body
  config: {                        // TestConfig
    timeoutMs: 30000,
    sampleDurationMs: 10000,
    adaptivePayload: true
  }
}, [signalPort]);                  // Optional: transfer MessagePort for abort signaling
```

**Fields**:
- `type`: Always `'run'`
- `pluginId`: Plugin identifier for result correlation
- `pluginName`: Display name (worker may not have access to plugin object metadata)
- `pluginCategory`: Category for results
- `pluginRunCode`: String representation of the plugin's `run()` function. The worker `eval`s this into a callable function. Must be self-contained (no external imports).
- `config`: TestConfig object with execution parameters

**Transfer**: An optional `MessagePort` (via `signalPort`) is transferred for AbortSignal proxying. The worker listens on this port for abort messages.

### 2. `result` — Worker → Main Thread

Reports a successful test measurement.

```js
self.postMessage({
  type: 'result',
  pluginId: 'fast-com',
  result: {
    targetName: 'Fast.com (Netflix)',
    pluginId: 'fast-com',
    status: 'success',
    downloadSpeedMbps: 87.5,
    durationMs: 8423,
    bytesTransferred: 52428800,
    errorMessage: null,
    timestamp: '2026-08-10T14:30:00.000Z'
  }
});
```

**Fields**:
- `type`: Always `'result'`
- `pluginId`: Matches the plugin ID from the `run` message
- `result`: Complete TestResult object. Must pass all TestResult validation rules.

### 3. `error` — Worker → Main Thread

Reports a plugin execution error (unexpected failure, not a test measurement error).

```js
self.postMessage({
  type: 'error',
  pluginId: 'fast-com',
  error: 'Worker terminated unexpectedly during execution'
});
```

**Fields**:
- `type`: Always `'error'`
- `pluginId`: Plugin identifier
- `error`: Human-readable error string

**When this is used**: The `error` message type is for worker-level failures (e.g., uncaught exception in the worker, eval failure, syntax error in plugin code). Normal test failures (CORS, timeout, network error) are reported via `type: 'result'` with `status: 'error'`.

### 4. `abort` — Main Thread → Worker (via MessagePort)

Signals the worker to abort execution. Sent over the transferred MessagePort, not `postMessage`.

```js
// Main thread
signalPort.postMessage({ type: 'abort' });

// Worker (listening on the other port)
port.onmessage = (e) => {
  if (e.data.type === 'abort') {
    controller.abort(); // Abort any in-flight fetch()
  }
};
```

**Fields**:
- `type`: Always `'abort'`

### 5. `progress` — Worker → Main Thread (Optional, Future)

Reserved for future progress reporting during test execution.

```js
self.postMessage({
  type: 'progress',
  pluginId: 'fast-com',
  phase: 'scale',
  bytesDownloaded: 10485760,
  estimatedSpeedMbps: 85.2
});
```

**Not implemented in MVP** — defined for forward compatibility. The main thread ignores unknown message types.

## Message Validation

Both sides MUST validate incoming messages:

### Main Thread Validation

```js
worker.onmessage = (e) => {
  const { type, pluginId, result, error } = e.data;

  if (type === 'result') {
    // Validate result shape
    if (!result || !result.status) {
      console.error('Invalid result message from worker:', e.data);
      return;
    }
    handleResult(pluginId, result);
  } else if (type === 'error') {
    handleWorkerError(pluginId, error || 'Unknown worker error');
  } else {
    // Unknown message type — ignore
    console.warn('Unknown worker message type:', type);
  }
};
```

### Worker Validation

```js
self.onmessage = (e) => {
  const { type, pluginId, pluginName, pluginCategory, pluginRunCode, config } = e.data;

  if (type !== 'run') {
    // Unknown message type — ignore
    return;
  }

  if (!pluginRunCode || !config) {
    self.postMessage({
      type: 'error',
      pluginId: pluginId || 'unknown',
      error: 'Invalid run message: missing pluginRunCode or config'
    });
    return;
  }

  executePlugin(pluginId, pluginName, pluginCategory, pluginRunCode, config);
};
```

## Timeout Handling

The main thread enforces timeouts, not the worker:

```js
const timeoutId = setTimeout(() => {
  abortController.abort();            // Signal the plugin to stop
  signalPort.postMessage({ type: 'abort' }); // Signal the worker
  worker.terminate();                 // Force terminate after 2s grace period
  handleTimeout(pluginId);
}, config.timeoutMs + 2000); // 2s grace period for abort+cleanup
```

This ensures the worker cannot hang indefinitely even if the plugin ignores the abort signal.

## Worker Termination

Workers are terminated after use (post-result or post-timeout):

```js
// After receiving result
worker.terminate();

// After timeout
worker.terminate();
```

Workers are NOT reused across test runs — each run creates fresh workers.

## Error Recovery

If a worker throws an unhandled error:

```js
worker.onerror = (error) => {
  console.error('Worker error:', error);
  // Create synthetic error result
  handleResult(pluginId, {
    targetName: pluginName,
    pluginId,
    status: 'error',
    downloadSpeedMbps: null,
    durationMs: 0,
    bytesTransferred: 0,
    errorMessage: 'Internal test error — worker failed unexpectedly',
    timestamp: new Date().toISOString()
  });
};
```

The `worker.onerror` handler catches any uncaught exception in the worker, preventing silent failures and ensuring the main thread always receives a result (even if synthetic).
