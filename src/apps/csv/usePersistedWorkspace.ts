export type { PersistenceState } from "./csvWorkspaceState";

// OPFS lifecycle wiring currently lives in CsvWorkspaceApp while the workspace is
// being decomposed. This module is the extraction seam for the persisted
// workspace hook so follow-up changes can move the effect without changing
// public imports again.
export function usePersistedWorkspace(): void {
  return undefined;
}
