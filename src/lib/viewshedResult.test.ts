import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialViewshedResultState,
  reduceViewshedResult,
  VisibilityObjectUrl,
  viewshedPayloadError,
} from './viewshedResult';

test('stale-run success and failure responses do not change the active result', () => {
  const running = reduceViewshedResult(initialViewshedResultState, {
    type: 'START',
    runId: 2,
  });
  assert.equal(
    reduceViewshedResult(running, {type: 'SUCCESS', runId: 1, timestamp: 10}),
    running
  );
  assert.equal(
    reduceViewshedResult(running, {
      type: 'ERROR',
      runId: 1,
      timestamp: 11,
      message: 'old',
    }),
    running
  );
});

test('worker failure records a timestamped, user-displayable error', () => {
  const running = reduceViewshedResult(initialViewshedResultState, {
    type: 'START',
    runId: 4,
  });
  assert.deepEqual(
    reduceViewshedResult(running, {
      type: 'ERROR',
      runId: 4,
      timestamp: 99,
      message: 'terrain unavailable',
    }),
    {
      activeRunId: 4,
      status: 'error',
      resultTimestamp: 99,
      errorMessage: 'terrain unavailable',
    }
  );
});

test('missing and malformed image buffers are rejected', () => {
  assert.match(
    viewshedPayloadError({nx: 1, ny: 1, bounds: [0, 0, 1, 1]})!,
    /buffer/
  );
  assert.match(
    viewshedPayloadError({
      buffer: new ArrayBuffer(0),
      nx: 1,
      ny: 1,
      bounds: [0, 0, 1, 1],
    })!,
    /size/
  );
});

test('a malformed response can be attributed to the active run', () => {
  const running = reduceViewshedResult(initialViewshedResultState, {
    type: 'START',
    runId: 7,
  });
  const missingRunIdError = reduceViewshedResult(running, {
    type: 'ERROR',
    runId: running.activeRunId!,
    timestamp: 101,
    message: 'The worker response did not include a valid run identifier.',
  });

  assert.equal(missingRunIdError.status, 'error');
  assert.equal(missingRunIdError.activeRunId, 7);
  assert.match(missingRunIdError.errorMessage!, /run identifier/);
});

test('null blobs are not accepted as object URL replacements', () => {
  const urls = new VisibilityObjectUrl();
  assert.throws(() => urls.replace(null as unknown as Blob));
  assert.equal(urls.current, null);
});

test('successful replacement revokes the prior URL', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  let id = 0;
  URL.createObjectURL = () => `blob:${++id}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const urls = new VisibilityObjectUrl();
    assert.equal(urls.replace(new Blob()), 'blob:1');
    assert.equal(urls.replace(new Blob()), 'blob:2');
    assert.deepEqual(revoked, ['blob:1']);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test('cleanup revokes the installed URL', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.createObjectURL = () => 'blob:result';
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const urls = new VisibilityObjectUrl();
    urls.replace(new Blob());
    urls.clear();
    assert.deepEqual(revoked, ['blob:result']);
    assert.equal(urls.current, null);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
