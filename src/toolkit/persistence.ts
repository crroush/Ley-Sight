/** Supported browser workspace persistence API. */
export {
  clearPersistedWorkspace,
  loadWorkspaceManifests,
  materializeCsvFile,
  opfsSupported,
  parseWorkspaceManifest,
  persistCsvFile,
  requestPersistentStorage,
  saveWorkspaceManifest,
  type PersistedCsvFile,
  type PersistedCsvTab,
  type PersistedWorkspace,
  type PersistedWorkspaceRecord,
} from '../storage/opfsWorkspace';
