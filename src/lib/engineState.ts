import type {EngineDatasetState} from './types';

export function extendEngineState(
  state: EngineDatasetState | undefined,
  rowCount: number
): EngineDatasetState | undefined {
  if (!state || rowCount < state.visible.length) return undefined;
  const visible = new Uint8Array(rowCount);
  visible.fill(1);
  visible.set(state.visible);
  const deleted = new Uint8Array(rowCount);
  deleted.set(state.deleted);
  const selected = new Uint8Array(rowCount);
  selected.set(state.selected);
  const manualVisible = new Uint8Array(rowCount);
  manualVisible.fill(1);
  manualVisible.set(state.manualVisible ?? state.visible);
  return {
    visible,
    manualVisible,
    deleted,
    selected,
    timeRange: [...state.timeRange],
  };
}
