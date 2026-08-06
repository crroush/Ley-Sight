import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeCombinedEngineState,
  splitCombinedEngineState,
} from './multiDatasetState';

test('dataset masks survive reordering when the active table changes', () => {
  const state = {
    visible: Uint8Array.from([1, 0, 1, 1, 0]),
    manualVisible: Uint8Array.from([1, 0, 1, 1, 0]),
    deleted: Uint8Array.from([0, 0, 1, 0, 0]),
    selected: Uint8Array.from([0, 1, 0, 1, 0]),
    timeRange: [10, 20] as [number, number],
  };
  const split = splitCombinedEngineState(state, [
    {id: 2, rowCount: 2},
    {id: 1, rowCount: 3},
  ]);
  const reordered = composeCombinedEngineState(
    [
      {id: 1, rowCount: 3},
      {id: 2, rowCount: 2},
    ],
    split,
    state.timeRange
  );

  assert.deepEqual(Array.from(reordered.visible), [1, 1, 0, 1, 0]);
  assert.deepEqual(Array.from(reordered.manualVisible ?? []), [1, 1, 0, 1, 0]);
  assert.deepEqual(Array.from(reordered.deleted), [1, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(reordered.selected), [0, 1, 0, 0, 1]);
  assert.deepEqual(reordered.timeRange, [10, 20]);
});
