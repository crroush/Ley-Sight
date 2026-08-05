import type { EngineDatasetState } from './types'
import { extendEngineState } from './engineState'

type DatasetRows = { id: number; rowCount: number }

export function splitCombinedEngineState(
  state: EngineDatasetState,
  datasets: DatasetRows[]
): Map<number, EngineDatasetState> {
  const result = new Map<number, EngineDatasetState>()
  let offset = 0
  for (const dataset of datasets) {
    result.set(dataset.id, {
      visible: state.visible.slice(offset, offset + dataset.rowCount),
      manualVisible: state.manualVisible?.slice(
        offset,
        offset + dataset.rowCount
      ),
      deleted: state.deleted.slice(offset, offset + dataset.rowCount),
      selected: state.selected.slice(offset, offset + dataset.rowCount),
      timeRange: [...state.timeRange],
    })
    offset += dataset.rowCount
  }
  return result
}

export function composeCombinedEngineState(
  datasets: DatasetRows[],
  states: ReadonlyMap<number, EngineDatasetState>,
  timeRange: [number, number]
): EngineDatasetState {
  const rowCount = datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0)
  const visible = new Uint8Array(rowCount)
  visible.fill(1)
  const deleted = new Uint8Array(rowCount)
  const selected = new Uint8Array(rowCount)
  const manualVisible = new Uint8Array(rowCount)
  manualVisible.fill(1)
  let offset = 0
  for (const dataset of datasets) {
    const state = extendEngineState(states.get(dataset.id), dataset.rowCount)
    if (state) {
      visible.set(state.visible, offset)
      manualVisible.set(state.manualVisible ?? state.visible, offset)
      deleted.set(state.deleted, offset)
      selected.set(state.selected, offset)
    }
    offset += dataset.rowCount
  }
  return {
    visible,
    manualVisible,
    deleted,
    selected,
    timeRange: [...timeRange],
  }
}
