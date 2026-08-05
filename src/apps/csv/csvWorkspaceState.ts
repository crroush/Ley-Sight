import type {
  AppendableDataset,
  CsvColumnMapping,
  DatasetSummary,
  EngineDatasetState,
  EngineSelectionState,
  MeasurementState,
  PackedDataset,
  PackedTableData,
  RenderMetrics,
} from "../../lib/types";
import { buildFineTimeHistogram } from "../../lib/timeHistogram";
import { gradientColor, type ColorPalette } from "../../lib/colorPalettes";
import type { ColorValueMode } from "../../lib/colorValueModes";
import { buildCompactSpatialIndex } from "../../map/compactIndex";
import type {
  PersistedCsvFile,
  PersistedCsvTab,
  PersistedWorkspace,
} from "../../storage/opfsWorkspace";

export const EMPTY_METRICS: RenderMetrics = {
  totalPoints: 0,
  visiblePoints: 0,
  visitedNodes: 0,
  collapsedNodes: 0,
  drawnPoints: 0,
  drawnEllipses: 0,
  renderMs: 0,
};
export const EMPTY_HISTOGRAM = new Uint32Array(96);
export const UNIFORM_COLOR_FIELD = "__uniform__";
export const SYNTHETIC_CLUSTER_FIELD = "__synthetic_cluster__";
export const SYNTHETIC_TIME_FIELD = "__synthetic_time__";
export const EMPTY_SELECTION: EngineSelectionState = { count: 0, revision: 0 };
export const EMPTY_MEASUREMENT: MeasurementState = {
  pointCount: 0,
  segmentMeters: [],
  totalMeters: 0,
};

export type DatasetTab = {
  id: number;
  kind: "csv" | "synthetic";
  schemaKey: string;
  title: string;
  columns: string[];
  files: File[];
  storageId?: string;
  persistedFiles: PersistedCsvFile[];
  mapping?: CsvColumnMapping;
  colorField: string;
  colorPalette: ColorPalette;
  colorValueMode: ColorValueMode;
  dataset: PackedDataset | null;
  tableData: PackedTableData | null;
  summary: DatasetSummary | null;
  engineState?: EngineDatasetState;
  timeFilterRange?: [number, number];
  timeViewRange?: [number, number];
  status: "loading" | "ready";
};

export type ImportGroup = {
  schemaKey: string;
  columns: string[];
  files: File[];
  persistedFiles: PersistedCsvFile[];
};

export type RecoveryImport = {
  group: ImportGroup;
  tab: PersistedCsvTab;
};

export type PersistenceState =
  | "checking"
  | "available"
  | "saving"
  | "restoring"
  | "unavailable"
  | "error";

export type LoadPending = {
  kind: "load";
  requestId: number;
  tabId: number;
  previousTab?: DatasetTab;
  recolorAfterLoad?: string;
};

export type RecolorPending = {
  kind: "recolor";
  requestId: number;
  tabId: number;
  colorField: string;
  colorPalette: ColorPalette;
  colorValueMode: ColorValueMode;
};

export type PendingOperation = LoadPending | RecolorPending;

export function csvImportLog(event: string, details: Record<string, unknown>): void {
  console.info(`[LeySight CSV] ${event}`, details);
}

export function concatenate<T extends Float64Array | Float32Array | Uint32Array>(
  arrays: T[],
  Constructor: {new (length: number): T},
): T {
  const result = new Constructor(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

export function displayColors(tab: DatasetTab): Uint32Array<ArrayBuffer> {
  const dataset = tab.dataset!;
  if (tab.colorField === UNIFORM_COLOR_FIELD) {
    const colors = new Uint32Array(dataset.colors.length);
    colors.fill(0x3288bdde);
    return colors;
  }
  if (tab.colorField !== SYNTHETIC_TIME_FIELD) return dataset.colors;
  const minimum = tab.summary?.timeMin ?? Number.NaN;
  const maximum = tab.summary?.timeMax ?? Number.NaN;
  const span = Math.max(1, maximum - minimum);
  return Uint32Array.from(dataset.time, (value) =>
    Number.isFinite(value) && Number.isFinite(minimum) && Number.isFinite(maximum)
      ? gradientColor((value - minimum) / span, tab.colorPalette, 224)
      : 0x64748bdd
  ) as Uint32Array<ArrayBuffer>;
}

export const combinedDatasetCache = new Map<number, {
  sources: PackedDataset[];
  value: {dataset: PackedDataset; summary: DatasetSummary; activeRows: number};
}>();

export function combinedMapDataset(tabs: DatasetTab[], activeId: number): {
  dataset: PackedDataset;
  summary: DatasetSummary;
  activeRows: number;
} | null {
  const active = tabs.find((tab) => tab.id === activeId && tab.dataset && tab.summary);
  if (!active?.dataset || !active.summary) return null;
  const sources = [active, ...tabs.filter(
    (tab) => tab.id !== activeId && tab.dataset && tab.summary,
  )];
  const datasets = sources.map((tab) => tab.dataset!);
  const summaries = sources.map((tab) => tab.summary!);
  if (datasets.length === 1) {
    return {
      dataset: active.colorField === UNIFORM_COLOR_FIELD ||
          active.colorField === SYNTHETIC_TIME_FIELD
        ? {...active.dataset, colors: displayColors(active)}
        : active.dataset,
      summary: active.summary,
      activeRows: active.summary.rowCount,
    };
  }
  const cached = combinedDatasetCache.get(activeId);
  if (
    cached &&
    cached.sources.length === datasets.length &&
    cached.sources.every((dataset, index) => dataset === datasets[index])
  ) {
    return cached.value;
  }
  const x = concatenate(datasets.map((dataset) => dataset.x), Float64Array);
  const y = concatenate(datasets.map((dataset) => dataset.y), Float64Array);
  const times = concatenate(datasets.map((dataset) => dataset.time), Float64Array);
  const finiteMinimums = summaries.map((summary) => summary.timeMin).filter(Number.isFinite);
  const finiteMaximums = summaries.map((summary) => summary.timeMax).filter(Number.isFinite);
  const timeMin = finiteMinimums.length ? Math.min(...finiteMinimums) : Number.NaN;
  const timeMax = finiteMaximums.length ? Math.max(...finiteMaximums) : Number.NaN;
  const extent: [number, number, number, number] = [
    Math.min(...datasets.map((dataset) => dataset.extent[0])),
    Math.min(...datasets.map((dataset) => dataset.extent[1])),
    Math.max(...datasets.map((dataset) => dataset.extent[2])),
    Math.max(...datasets.map((dataset) => dataset.extent[3])),
  ];
  const dataset: PackedDataset = {
    x,
    y,
    semiMajor: concatenate(datasets.map((item) => item.semiMajor), Float32Array),
    semiMinor: concatenate(datasets.map((item) => item.semiMinor), Float32Array),
    rotation: concatenate(datasets.map((item) => item.rotation), Float32Array),
    time: times,
    colors: concatenate(sources.map(displayColors), Uint32Array),
    extent,
    index: buildCompactSpatialIndex(x, y),
    timeHistogram: buildFineTimeHistogram(times, timeMin, timeMax),
  };
  const value = {
    dataset,
    activeRows: active.summary.rowCount,
    summary: {
      name: sources.length === 1 ? active.summary.name : `${sources.length} datasets`,
      rowCount: x.length,
      timeMin,
      timeMax,
      invalidRows: summaries.reduce((sum, item) => sum + item.invalidRows, 0),
      invalidTimestamps: summaries.reduce((sum, item) => sum + (item.invalidTimestamps ?? 0), 0),
      coordinateFailures: summaries.reduce((sum, item) => sum + (item.coordinateFailures ?? 0), 0),
      projectionClampedRows: summaries.reduce((sum, item) => sum + (item.projectionClampedRows ?? 0), 0),
    },
  };
  combinedDatasetCache.set(activeId, {sources: datasets, value});
  return value;
}

export function formatCompact(value: number): string {
  return Intl.NumberFormat(undefined, {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDistance(meters: number): string {
  return meters >= 1_000
    ? `${(meters / 1_000).toFixed(2)} km`
    : `${meters.toFixed(1)} m`;
}

export function persistenceLabel(state: PersistenceState): string {
  if (state === "saving") return "SAVING TO OPFS";
  if (state === "restoring") return "RESTORING OPFS";
  if (state === "available") return "OPFS RECOVERY";
  if (state === "checking") return "CHECKING STORAGE";
  if (state === "error") return "RECOVERY ERROR";
  return "SESSION ONLY";
}

export function booleanPreference(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    return stored == null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

export function tabTitle(file: File): string {
  return file.name.replace(/\.csv$/i, "") || file.name;
}

export function datasetStorageId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `dataset-${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`;
}

export function browserSessionId(): string {
  const key = "leysight.csv.sessionId";
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = datasetStorageId();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return datasetStorageId();
  }
}

export function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function appendableDataset(
  dataset: PackedDataset,
  summary: DatasetSummary,
): AppendableDataset {
  return {
    x: dataset.x,
    y: dataset.y,
    semiMajor: dataset.semiMajor,
    semiMinor: dataset.semiMinor,
    rotation: dataset.rotation,
    time: dataset.time,
    colors: dataset.colors,
    extent: dataset.extent,
    invalidRows: summary.invalidRows,
    invalidTimestamps: summary.invalidTimestamps ?? 0,
    coordinateFailures: summary.coordinateFailures ?? 0,
    projectionClampedRows: summary.projectionClampedRows ?? 0,
    timeMin: summary.timeMin,
    timeMax: summary.timeMax,
  };
}

export function workspaceManifest(
  tabs: readonly DatasetTab[],
  activeTabId: number | null,
): PersistedWorkspace {
  const persistedTabs = tabs.flatMap<PersistedCsvTab>((tab) => {
    if (
      tab.kind !== "csv" ||
      tab.status !== "ready" ||
      !tab.mapping ||
      !tab.storageId ||
      !tab.persistedFiles.length ||
      tab.persistedFiles.length !== tab.files.length
    ) {
      return [];
    }
    return [{
      storageId: tab.storageId,
      schemaKey: tab.schemaKey,
      title: tab.title,
      columns: tab.columns,
      files: tab.persistedFiles,
      mapping: tab.mapping,
      colorField: tab.colorField,
      colorPalette: tab.colorPalette,
      colorValueMode: tab.colorValueMode,
      timeFilterRange: tab.timeFilterRange,
      timeViewRange: tab.timeViewRange,
    }];
  });
  const activeStorageId = tabs.find((tab) => tab.id === activeTabId)?.storageId;
  return {
    version: 1,
    activeStorageId,
    tabs: persistedTabs,
  };
}

