import type {
  CsvColumnMapping,
} from "../lib/types";
import type {ColorPalette} from "../lib/colorPalettes";
import type {ColorValueMode} from "../lib/colorValueModes";

const STORAGE_DIRECTORY = "leysight";
const FILES_DIRECTORY = "csv";
const MANIFEST_FILE = "workspace-v1.json";
const MANIFEST_VERSION = 1;

export type PersistedCsvFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
};

export type PersistedCsvTab = {
  storageId: string;
  schemaKey: string;
  title: string;
  columns: string[];
  files: PersistedCsvFile[];
  mapping: CsvColumnMapping;
  colorField: string;
  colorPalette: ColorPalette;
  colorValueMode: ColorValueMode;
  timeFilterRange?: [number, number];
  timeViewRange?: [number, number];
};

export type PersistedWorkspace = {
  version: 1;
  activeStorageId?: string;
  tabs: PersistedCsvTab[];
};

function storageManager(): StorageManager | null {
  return typeof navigator === "undefined" ||
      !navigator.storage ||
      typeof navigator.storage.getDirectory !== "function"
    ? null
    : navigator.storage;
}

export function opfsSupported(): boolean {
  return storageManager() !== null;
}

async function appDirectory(
  create = true,
): Promise<FileSystemDirectoryHandle> {
  const storage = storageManager();
  if (!storage) throw new Error("This browser does not support OPFS.");
  const root = await storage.getDirectory();
  return root.getDirectoryHandle(STORAGE_DIRECTORY, {create});
}

async function csvDirectory(
  create = true,
): Promise<FileSystemDirectoryHandle> {
  return (await appDirectory(create)).getDirectoryHandle(FILES_DIRECTORY, {
    create,
  });
}

function storageFileId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Streams a browser File directly into OPFS. No whole-file ArrayBuffer or text
 * copy is created, so multi-gigabyte CSVs do not need duplicate heap space.
 */
export async function persistCsvFile(file: File): Promise<PersistedCsvFile> {
  const id = storageFileId();
  const directory = await csvDirectory();
  const handle = await directory.getFileHandle(id, {create: true});
  const writable = await handle.createWritable();
  try {
    await file.stream().pipeTo(writable);
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    await directory.removeEntry(id).catch(() => undefined);
    throw error;
  }
  return {
    id,
    name: file.name,
    type: file.type || "text/csv",
    size: file.size,
    lastModified: file.lastModified,
  };
}

export async function materializeCsvFile(
  record: PersistedCsvFile,
): Promise<File> {
  const directory = await csvDirectory(false);
  const handle = await directory.getFileHandle(record.id);
  const stored = await handle.getFile();
  if (stored.size !== record.size) {
    throw new Error(
      `${record.name} is incomplete in persistent storage ` +
      `(${stored.size.toLocaleString()} of ${record.size.toLocaleString()} bytes).`,
    );
  }
  return new File([stored], record.name, {
    type: record.type || stored.type || "text/csv",
    lastModified: record.lastModified,
  });
}

export async function saveWorkspaceManifest(
  workspace: PersistedWorkspace,
): Promise<void> {
  const directory = await appDirectory();
  const handle = await directory.getFileHandle(MANIFEST_FILE, {create: true});
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(workspace));
  await writable.close();
}

function isPersistedFile(value: unknown): value is PersistedCsvFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<PersistedCsvFile>;
  return (
    typeof file.id === "string" &&
    typeof file.name === "string" &&
    typeof file.type === "string" &&
    typeof file.size === "number" &&
    typeof file.lastModified === "number"
  );
}

function isOptionalFiniteRange(
  value: unknown,
): value is [number, number] | undefined {
  return value === undefined || (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry)) &&
    value[0] <= value[1]
  );
}

function isPersistedTab(value: unknown): value is PersistedCsvTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Partial<PersistedCsvTab>;
  return (
    typeof tab.storageId === "string" &&
    typeof tab.schemaKey === "string" &&
    typeof tab.title === "string" &&
    Array.isArray(tab.columns) &&
    tab.columns.every((column) => typeof column === "string") &&
    Array.isArray(tab.files) &&
    tab.files.every(isPersistedFile) &&
    Boolean(tab.mapping) &&
    typeof tab.colorField === "string" &&
    typeof tab.colorPalette === "string" &&
    typeof tab.colorValueMode === "string" &&
    isOptionalFiniteRange(tab.timeFilterRange) &&
    isOptionalFiniteRange(tab.timeViewRange)
  );
}

export function parseWorkspaceManifest(value: unknown): PersistedWorkspace {
  if (!value || typeof value !== "object") {
    throw new Error("The saved LeySight workspace manifest is invalid.");
  }
  const workspace = value as Partial<PersistedWorkspace>;
  if (
    workspace.version !== MANIFEST_VERSION ||
    !Array.isArray(workspace.tabs) ||
    !workspace.tabs.every(isPersistedTab)
  ) {
    throw new Error("The saved LeySight workspace uses an unsupported format.");
  }
  return {
    version: MANIFEST_VERSION,
    activeStorageId:
      typeof workspace.activeStorageId === "string"
        ? workspace.activeStorageId
        : undefined,
    tabs: workspace.tabs,
  };
}

export async function loadWorkspaceManifest(): Promise<PersistedWorkspace | null> {
  if (!opfsSupported()) return null;
  try {
    const directory = await appDirectory(false);
    const handle = await directory.getFileHandle(MANIFEST_FILE);
    const file = await handle.getFile();
    return parseWorkspaceManifest(JSON.parse(await file.text()));
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return null;
    }
    throw error;
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  const storage = storageManager();
  if (!storage || typeof storage.persist !== "function") return false;
  return storage.persist();
}

export async function clearPersistedWorkspace(): Promise<void> {
  const storage = storageManager();
  if (!storage) return;
  const root = await storage.getDirectory();
  await root.removeEntry(STORAGE_DIRECTORY, {recursive: true}).catch(
    (error: unknown) => {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) {
        throw error;
      }
    },
  );
}
