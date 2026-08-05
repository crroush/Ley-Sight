import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extendEngineState } from './engineState'

describe('extendEngineState', () => {
  it('preserves prior masks and defaults appended rows to visible', () => {
    const extended = extendEngineState(
      {
        visible: new Uint8Array([1, 0]),
        deleted: new Uint8Array([0, 1]),
        selected: new Uint8Array([1, 0]),
        timeRange: [10, 20],
      },
      4
    )

    assert.deepEqual(Array.from(extended!.visible), [1, 0, 1, 1])
    assert.deepEqual(Array.from(extended!.deleted), [0, 1, 0, 0])
    assert.deepEqual(Array.from(extended!.selected), [1, 0, 0, 0])
    assert.deepEqual(extended!.timeRange, [10, 20])
  })
})
