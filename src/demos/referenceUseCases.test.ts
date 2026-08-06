import assert from 'node:assert/strict';
import test from 'node:test';
import {REFERENCE_USE_CASES} from './referenceUseCases';

test('parity catalog contains every numbered Reference example exactly once', () => {
  assert.equal(REFERENCE_USE_CASES.length, 22);
  assert.deepEqual(
    REFERENCE_USE_CASES.map((useCase) => useCase.id),
    Array.from({length: 22}, (_, index) => index + 1)
  );
});

test('unreleased use cases remain explicitly marked in progress', () => {
  for (const useCase of REFERENCE_USE_CASES) {
    assert.notEqual(useCase.status, 'available', useCase.contract.sourcePath);
    assert.ok(useCase.remaining.length > 0);
  }
});

test('every Reference use case launches a built browser route', () => {
  const expectedRoutes = new Set([
    '/csv.html',
    '/events.html',
    '/filtering.html',
    '/linked-tables.html',
    '/raster.html',
    '/vector.html',
  ]);
  for (const useCase of REFERENCE_USE_CASES) {
    const route = useCase.href.split('?')[0];
    assert.ok(expectedRoutes.has(route), useCase.href);
    assert.match(
      useCase.href,
      new RegExp(`example=${String(useCase.id).padStart(2, '0')}$`)
    );
    assert.equal(
      useCase.contract.sourcePath,
      `examples/${String(useCase.id).padStart(2, '0')}_${
        useCase.contract.sourcePath.split(
          `${String(useCase.id).padStart(2, '0')}_`
        )[1]
      }`
    );
    assert.ok(useCase.contract.window.length > 0);
    assert.ok(useCase.contract.data.length > 0);
    assert.ok(useCase.contract.interactions.length > 0);
  }
});
