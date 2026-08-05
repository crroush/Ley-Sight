// Data-worker request, recolor, and load orchestration currently lives in
// CsvWorkspaceApp while the workspace is being decomposed. This module is the
// extraction seam for the worker hook so follow-up changes can move that logic
// without changing public imports again.
export function useCsvDataWorker(): void {
  return undefined
}
