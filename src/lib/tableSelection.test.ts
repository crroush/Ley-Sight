import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {sourceIndexPosition, tableSelectionRange} from './tableSelection';

describe('table range selection', () => {
  it('selects a contiguous source range in either direction', () => {
    assert.deepEqual([...tableSelectionRange(2, 5, 10, null)], [2, 3, 4, 5]);
    assert.deepEqual([...tableSelectionRange(5, 2, 10, null)], [2, 3, 4, 5]);
  });

  it('follows filtered table order', () => {
    const visible = Uint32Array.from([4, 8, 15, 16, 23, 42]);
    assert.deepEqual(
      [...tableSelectionRange(1, 4, 100, visible)],
      [8, 15, 16, 23]
    );
  });

  it('keeps selection tied to source rows when presentation order changes', () => {
    const selected = Uint8Array.from([0, 1, 0, 0, 1, 0]);
    const sorted = Uint32Array.from([5, 4, 3, 2, 1, 0]);

    assert.equal(sourceIndexPosition(sorted, 1), 4);
    assert.equal(sourceIndexPosition(sorted, 4), 1);
    assert.deepEqual(Array.from(selected), [0, 1, 0, 0, 1, 0]);
  });

  it('reports a missing focus row without changing selection', () => {
    const sortedVisible = Uint32Array.from([4, 2, 0]);
    assert.equal(sourceIndexPosition(sortedVisible, 1), -1);
    assert.equal(sourceIndexPosition(sortedVisible, -1), -1);
  });
});
