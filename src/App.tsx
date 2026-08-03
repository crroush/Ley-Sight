import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Papa from "papaparse";
import {
  Database,
  Download,
  ChartNoAxesColumn,
  Eye,
  EyeOff,
  FileUp,
  Focus,
  Layers,
  MapPinned,
  Moon,
  PanelBottomOpen,
  Ruler,
  Settings,
  Sun,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import {
  DEFAULT_APP_CONFIG,
  loadAppConfig,
  type AppConfig,
} from "./config/appConfig";
import { CsvMappingDialog } from "./components/CsvMappingDialog";
import { HistogramRange } from "./components/HistogramRange";
import { LayerManagerDialog } from "./components/LayerManagerDialog";
import { MapPanel } from "./components/MapPanel";
import { PaneSeparator } from "./components/PaneSeparator";
import { VirtualDataTable } from "./components/VirtualDataTable";
import type {
  AppendableDataset,
  CsvColumnMapping,
  DataWorkerEvent,
  DatasetSummary,
  EngineDatasetState,
  EngineSelectionState,
  MapLayerSettings,
  MeasurementState,
  PackedDataset,
  PackedTableData,
  RenderMetrics,
  WorkerProgress,
} from "./lib/types";
import { csvSchemaKey } from "./lib/csvSchema";
import { extendEngineState } from "./lib/engineState";
import {
  composeCombinedEngineState,
  splitCombinedEngineState,
} from "./lib/multiDatasetState";
import {buildFineTimeHistogram} from "./lib/timeHistogram";
import {
  COLOR_PALETTES,
  paletteCss,
  type ColorPalette,
} from "./lib/colorPalettes";
import {
  COLOR_VALUE_MODES,
  type ColorValueMode,
} from "./lib/colorValueModes";
import type { FastPointEngine } from "./map/FastPointEngine";
import {buildCompactSpatialIndex} from "./map/compactIndex";
import {tableColumnValue} from "./workers/tableColumns";
import {
  clearPersistedWorkspace,
  loadWorkspaceManifest,
  materializeCsvFile,
  opfsSupported,
  persistCsvFile,
  requestPersistentStorage,
  saveWorkspaceManifest,
  type PersistedCsvFile,
  type PersistedCsvTab,
  type PersistedWorkspace,
} from "./storage/opfsWorkspace";

const EMPTY_METRICS: RenderMetrics = {
  totalPoints: 0,
  visiblePoints: 0,
  visitedNodes: 0,
  collapsedNodes: 0,
  drawnPoints: 0,
  drawnEllipses: 0,
  renderMs: 0,
};
const EMPTY_HISTOGRAM = new Uint32Array(96);
const UNIFORM_COLOR_FIELD = "__uniform__";
const SYNTHETIC_CLUSTER_FIELD = "__synthetic_cluster__";
const SYNTHETIC_TIME_FIELD = "__synthetic_time__";
const EMPTY_SELECTION: EngineSelectionState = { count: 0, revision: 0 };
const EMPTY_MEASUREMENT: MeasurementState = {
  pointCount: 0,
  segmentMeters: [],
  totalMeters: 0,
};

type DatasetTab = {
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

type ImportGroup = {
  schemaKey: string;
  columns: string[];
  files: File[];
  persistedFiles: PersistedCsvFile[];
};

type RecoveryImport = {
  group: ImportGroup;
  tab: PersistedCsvTab;
};

type PersistenceState =
  | "checking"
  | "available"
  | "saving"
  | "restoring"
  | "unavailable"
  | "error";

type LoadPending = {
  kind: "load";
  requestId: number;
  tabId: number;
  previousTab?: DatasetTab;
  recolorAfterLoad?: string;
};

type RecolorPending = {
  kind: "recolor";
  requestId: number;
  tabId: number;
  colorField: string;
  colorPalette: ColorPalette;
  colorValueMode: ColorValueMode;
};

type PendingOperation = LoadPending | RecolorPending;

function csvImportLog(event: string, details: Record<string, unknown>): void {
  console.info(`[LeySight CSV] ${event}`, details);
}

function concatenate<T extends Float64Array | Float32Array | Uint32Array>(
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

const combinedDatasetCache = new Map<number, {
  sources: PackedDataset[];
  value: {dataset: PackedDataset; summary: DatasetSummary; activeRows: number};
}>();

function combinedMapDataset(tabs: DatasetTab[], activeId: number): {
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
      dataset: active.dataset,
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
    colors: concatenate(datasets.map((item) => item.colors), Uint32Array),
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

function formatCompact(value: number): string {
  return Intl.NumberFormat(undefined, {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDistance(meters: number): string {
  return meters >= 1_000
    ? `${(meters / 1_000).toFixed(2)} km`
    : `${meters.toFixed(1)} m`;
}

function persistenceLabel(state: PersistenceState): string {
  if (state === "saving") return "SAVING TO OPFS";
  if (state === "restoring") return "RESTORING OPFS";
  if (state === "available") return "OPFS RECOVERY";
  if (state === "checking") return "CHECKING STORAGE";
  if (state === "error") return "RECOVERY ERROR";
  return "SESSION ONLY";
}

function booleanPreference(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    return stored == null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

function tabTitle(file: File): string {
  return file.name.replace(/\.csv$/i, "") || file.name;
}

function datasetStorageId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `dataset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function appendableDataset(
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

function workspaceManifest(
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

export function App() {
  const engineRef = useRef<FastPointEngine | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<DatasetTab[]>([]);
  const activeTabIdRef = useRef<number | null>(null);
  const datasetStateRef = useRef(new Map<number, EngineDatasetState>());
  const combinedTimeRangeRef = useRef<[number, number]>([-Infinity, Infinity]);
  const pendingRef = useRef<PendingOperation | null>(null);
  const requestIdRef = useRef(0);
  const tabIdRef = useRef(0);
  const importQueueRef = useRef<ImportGroup[]>([]);
  const recoveryQueueRef = useRef<RecoveryImport[]>([]);
  const recoveryActiveRef = useRef(true);
  const recoveryInitializedRef = useRef(false);
  const recoveredActiveStorageIdRef = useRef<string | undefined>(undefined);
  const mappingGroupRef = useRef<ImportGroup | null>(null);
  const advanceImportQueueRef = useRef<() => void>(() => undefined);
  const startCsvImportRef = useRef<
    (
      group: ImportGroup,
      mapping: CsvColumnMapping,
      existing?: DatasetTab,
      recovery?: PersistedCsvTab,
    ) => void
  >(() => undefined);
  const workerEventHandlerRef = useRef<(message: DataWorkerEvent) => void>(
    () => undefined,
  );
  const paneSizesRef = useRef({ map: 360, histogram: 180 });
  const panesInitializedRef = useRef(false);

  const [engine, setEngine] = useState<FastPointEngine | null>(null);
  const [tabs, setTabs] = useState<DatasetTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [summary, setSummary] = useState<DatasetSummary | null>(null);
  const [progress, setProgress] = useState<WorkerProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] =
    useState<EngineSelectionState>(EMPTY_SELECTION);
  const [visibleIndices, setVisibleIndices] = useState<Uint32Array | null>(null);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const [timeMinimum, setTimeMinimum] = useState(0);
  const [timeMaximum, setTimeMaximum] = useState(1);
  const [timeStart, setTimeStart] = useState(0);
  const [timeEnd, setTimeEnd] = useState(1);
  const [timeViewStart, setTimeViewStart] = useState(0);
  const [timeViewEnd, setTimeViewEnd] = useState(1);
  const [timeHistogram, setTimeHistogram] = useState(EMPTY_HISTOGRAM);
  const [mappingGroup, setMappingGroupState] = useState<ImportGroup | null>(
    null,
  );
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
  const [persistenceState, setPersistenceState] =
    useState<PersistenceState>("checking");
  const [showSettings, setShowSettings] = useState(false);
  const [showTimeline, setShowTimeline] = useState(() =>
    booleanPreference("leysight.csv.showTimeline", true),
  );
  const [showTable, setShowTable] = useState(() =>
    booleanPreference("leysight.csv.showTable", true),
  );
  const [measurementEnabled, setMeasurementEnabled] = useState(false);
  const [measurement, setMeasurement] =
    useState<MeasurementState>(EMPTY_MEASUREMENT);
  const [darkMode, setDarkMode] = useState(true);
  const [findValue, setFindValue] = useState("");
  const [paneSizes, setPaneSizes] = useState(paneSizesRef.current);
  const [settings, setSettings] = useState<MapLayerSettings>({
    baseLayer: DEFAULT_APP_CONFIG.baseLayers[0],
    baseVisible: true,
    baseOpacity: 0.72,
    managedLayers: [],
    countriesVisible: true,
    countryStrokeColor: "#64748b",
    mapBackgroundColor: "#0f172a",
    coordinatesVisible: true,
    ellipsesVisible: true,
    selectedEllipsesVisible: true,
  });

  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ?? null;

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "leysight.csv.showTimeline",
        String(showTimeline),
      );
      window.localStorage.setItem(
        "leysight.csv.showTable",
        String(showTable),
      );
    } catch {
      // Storage can be unavailable in privacy-restricted browser sessions.
    }
  }, [showTable, showTimeline]);

  useEffect(() => {
    if (
      !opfsSupported() ||
      recoveryActiveRef.current ||
      pendingRef.current ||
      mappingGroup ||
      progress
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setPersistenceState("saving");
      const manifest = workspaceManifest(tabs, activeTabId);
      void saveWorkspaceManifest(manifest)
        .then(() => {
          csvImportLog("OPFS manifest saved", {
            tabs: manifest.tabs.map((tab) => ({
              schemaKey: tab.schemaKey,
              files: tab.files.length,
            })),
          });
          setPersistenceState("available");
        })
        .catch((caught) => {
          setPersistenceState("error");
          setError(
            `Workspace persistence failed: ${
              caught instanceof Error ? caught.message : String(caught)
            }`,
          );
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [activeTabId, mappingGroup, progress, tabs]);

  useEffect(() => {
    void loadAppConfig()
      .then((loaded) => {
        setAppConfig(loaded);
        setSettings((current) => ({
          ...current,
          baseLayer:
            loaded.baseLayers.find(
              (layer) => layer.id === current.baseLayer.id,
            ) ?? loaded.baseLayers[0],
        }));
      })
      .catch((caught) => {
        setError(
          `${caught instanceof Error ? caught.message : String(caught)} Using built-in defaults.`,
        );
      });
  }, []);

  const replaceTabs = useCallback(
    (update: (current: DatasetTab[]) => DatasetTab[]): DatasetTab[] => {
      const next = update(tabsRef.current);
      tabsRef.current = next;
      setTabs(next);
      return next;
    },
    [],
  );

  const setMappingGroup = useCallback((group: ImportGroup | null): void => {
    mappingGroupRef.current = group;
    setMappingGroupState(group);
  }, []);

  const clearDatasetUi = useCallback((): void => {
    engineRef.current?.clear();
    setRowCount(0);
    setSummary(null);
    setSelection(EMPTY_SELECTION);
    setVisibleIndices(null);
    setMetrics(EMPTY_METRICS);
    setTimeHistogram(EMPTY_HISTOGRAM);
    setTimeMinimum(0);
    setTimeMaximum(1);
    setTimeStart(0);
    setTimeEnd(1);
    setTimeViewStart(0);
    setTimeViewEnd(1);
  }, []);

  const applyColorMode = useCallback((tab: DatasetTab): void => {
    const current = engineRef.current;
    if (!current) return;
    current.setColorPalette(tab.colorPalette);
    if (tab.colorField === UNIFORM_COLOR_FIELD) {
      current.setColorMode("uniform");
    } else if (tab.colorField === SYNTHETIC_TIME_FIELD) {
      current.setColorMode("time");
    } else {
      current.setColorMode("source");
    }
  }, []);

  const loadTabIntoEngine = useCallback(
    (tab: DatasetTab | undefined, fit = false): void => {
      const current = engineRef.current;
      if (!current || !tab?.dataset || !tab.summary) {
        clearDatasetUi();
        return;
      }
      const combined = combinedMapDataset(tabsRef.current, tab.id);
      if (!combined) {
        clearDatasetUi();
        return;
      }
      const orderedTabs = [tab, ...tabsRef.current.filter(
        (candidate) => candidate.id !== tab.id && candidate.dataset && candidate.summary,
      )];
      const hasRestoredMasks = orderedTabs.some((source) =>
        datasetStateRef.current.has(source.id)
      );
      current.loadDataset(
        combined.dataset,
        combined.summary,
        composeCombinedEngineState(
          orderedTabs.map((source) => ({
            id: source.id,
            rowCount: source.summary?.rowCount ?? 0,
          })),
          datasetStateRef.current,
          combinedTimeRangeRef.current,
        ),
      );
      applyColorMode(tab);
      setRowCount(combined.activeRows);
      setSummary(combined.summary);
      setTimeHistogram(combined.dataset.timeHistogram);
      setMetrics(EMPTY_METRICS);
      const hasTimes =
        Number.isFinite(combined.summary.timeMin) &&
        Number.isFinite(combined.summary.timeMax) &&
        combined.summary.timeMax > combined.summary.timeMin;
      if (hasTimes) {
        setTimeMinimum(combined.summary.timeMin);
        setTimeMaximum(combined.summary.timeMax);
        const restoredRange =
          tab.timeFilterRange ?? tab.engineState?.timeRange;
        // setTimeRange rebuilds the entire visible mask. Only use it for
        // recovery without saved masks; composed tab-switch masks already
        // carry both the time range and manual hide/show operations.
        if (restoredRange && !hasRestoredMasks) {
          current.setTimeRange(restoredRange[0], restoredRange[1]);
        }
        setTimeStart(
          restoredRange && Number.isFinite(restoredRange[0])
            ? restoredRange[0]
            : combined.summary.timeMin,
        );
        setTimeEnd(
          restoredRange && Number.isFinite(restoredRange[1])
            ? restoredRange[1]
            : combined.summary.timeMax,
        );
        const restoredView = tab.timeViewRange;
        setTimeViewStart(
          restoredView && Number.isFinite(restoredView[0])
            ? restoredView[0]
            : combined.summary.timeMin,
        );
        setTimeViewEnd(
          restoredView && Number.isFinite(restoredView[1])
            ? restoredView[1]
            : combined.summary.timeMax,
        );
      } else {
        setTimeMinimum(0);
        setTimeMaximum(1);
        setTimeStart(0);
        setTimeEnd(1);
        setTimeViewStart(0);
        setTimeViewEnd(1);
      }
      setVisibleIndices(
        current.visibleCount === combined.summary.rowCount
          ? null
          : current.visibleIndices().filter((index) => index < combined.activeRows),
      );
      csvImportLog("dataset activated", {
        tabId: tab.id,
        schemaKey: tab.schemaKey,
        files: tab.files.map((file) => file.name),
        rows: combined.summary.rowCount,
        datasetRows: combined.dataset.x.length,
        tableRows: tab.tableData?.rowCount ?? 0,
        visibleRows: current.visibleCount,
        timeRange: current.captureState().timeRange,
      });
      if (fit) current.fitToData();
    },
    [applyColorMode, clearDatasetUi],
  );

  const captureActiveState = useCallback((): void => {
    const id = activeTabIdRef.current;
    const current = engineRef.current;
    if (id == null || !current || current.count === 0) return;
    const state = current.captureState();
    combinedTimeRangeRef.current = [...state.timeRange];
    const active = tabsRef.current.find((tab) => tab.id === id);
    const orderedTabs = active
      ? [active, ...tabsRef.current.filter(
          (tab) => tab.id !== id && tab.dataset && tab.summary,
        )]
      : [];
    const splitState = splitCombinedEngineState(
      state,
      orderedTabs.map((tab) => ({
        id: tab.id,
        rowCount: tab.summary?.rowCount ?? 0,
      })),
    );
    for (const [tabId, tabState] of splitState) {
      datasetStateRef.current.set(tabId, tabState);
    }
    replaceTabs((existingTabs) =>
      existingTabs.map((tab) =>
        tab.id === id && tab.dataset
          ? {...tab, engineState: datasetStateRef.current.get(id)}
          : tab,
      ),
    );
  }, [replaceTabs]);

  const activateTab = useCallback(
    (id: number, fit = false): void => {
      if (activeTabIdRef.current !== id) captureActiveState();
      activeTabIdRef.current = id;
      setActiveTabId(id);
      const tab = tabsRef.current.find((candidate) => candidate.id === id);
      loadTabIntoEngine(tab, fit);
    },
    [captureActiveState, loadTabIntoEngine],
  );

  useEffect(() => {
    // Strict Mode intentionally mounts, cleans up, and remounts effects in
    // development. Ignore asynchronous work from the disposed generation so
    // one saved dataset can never be enqueued twice.
    let cancelled = false;
    const worker = new Worker(
      new URL("./workers/data.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<DataWorkerEvent>) => {
      workerEventHandlerRef.current(event.data);
    };
    void (async () => {
      if (!opfsSupported()) {
        if (cancelled) return;
        recoveryInitializedRef.current = true;
        recoveryActiveRef.current = false;
        setPersistenceState("unavailable");
        advanceImportQueueRef.current();
        return;
      }
      try {
        await requestPersistentStorage();
        if (cancelled) return;
        const workspace = await loadWorkspaceManifest();
        if (cancelled) return;
        if (!workspace?.tabs.length) {
          recoveryInitializedRef.current = true;
          recoveryActiveRef.current = false;
          setPersistenceState("available");
          advanceImportQueueRef.current();
          return;
        }
        setPersistenceState("restoring");
        recoveredActiveStorageIdRef.current = workspace.activeStorageId;
        for (const tab of workspace.tabs) {
          const files: File[] = [];
          for (const storedFile of tab.files) {
            files.push(await materializeCsvFile(storedFile));
            if (cancelled) return;
          }
          recoveryQueueRef.current.push({
            tab,
            group: {
              schemaKey: tab.schemaKey,
              columns: tab.columns,
              files,
              persistedFiles: tab.files,
            },
          });
        }
        recoveryInitializedRef.current = true;
        advanceImportQueueRef.current();
      } catch (caught) {
        if (cancelled) return;
        recoveryInitializedRef.current = true;
        recoveryActiveRef.current = false;
        setPersistenceState("error");
        setError(
          `Saved workspace recovery failed: ${
            caught instanceof Error ? caught.message : String(caught)
          }`,
        );
        advanceImportQueueRef.current();
      }
    })();
    return () => {
      cancelled = true;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, []);

  const handleEngine = useCallback(
    (nextEngine: FastPointEngine | null) => {
      engineRef.current = nextEngine;
      setEngine(nextEngine);
      if (!nextEngine) return;
      nextEngine.setBaseLayer(settings.baseLayer);
      nextEngine.setBaseVisible(settings.baseVisible);
      nextEngine.setBaseOpacity(settings.baseOpacity);
      nextEngine.setManagedLayers(settings.managedLayers);
      nextEngine.setCountryStrokeColor(settings.countryStrokeColor);
      nextEngine.setCountryBoundariesVisible(settings.countriesVisible);
      nextEngine.setMapBackgroundColor(settings.mapBackgroundColor);
      nextEngine.setEllipsesVisible(settings.ellipsesVisible);
      nextEngine.setSelectedEllipsesVisible(
        settings.selectedEllipsesVisible,
      );
      nextEngine.setMeasurementEnabled(measurementEnabled);
      const tab = tabsRef.current.find(
        (candidate) => candidate.id === activeTabIdRef.current,
      );
      loadTabIntoEngine(tab);
    },
    [loadTabIntoEngine, measurementEnabled, settings],
  );

  const handleSelectionChange = useCallback(
    (nextSelection: EngineSelectionState): void => {
      const current = engineRef.current;
      setSelection({
        count: current?.selectionCount ?? nextSelection.count,
        revision: nextSelection.revision,
      });
    },
    [],
  );

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const resize = (): void => {
      const height = workspace.clientHeight;
      if (!height) return;
      const dividerSpace = 14;
      const tableMinimum = 120;
      const histogramMinimum = 150;
      const mapMinimum = 170;
      const available = Math.max(
        mapMinimum + histogramMinimum,
        height - dividerSpace - tableMinimum,
      );
      setPaneSizes((current) => {
        const next = !panesInitializedRef.current
          ? {
              map: Math.max(mapMinimum, Math.round(available * 0.72)),
              histogram: Math.max(
                histogramMinimum,
                available - Math.round(available * 0.72),
              ),
            }
          : {
              map: Math.max(
                mapMinimum,
                Math.min(
                  current.map,
                  height - dividerSpace - histogramMinimum - tableMinimum,
                ),
              ),
              histogram: Math.max(
                histogramMinimum,
                Math.min(
                  current.histogram,
                  height - dividerSpace - mapMinimum - tableMinimum,
                ),
              ),
            };
        panesInitializedRef.current = true;
        paneSizesRef.current = next;
        return next;
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(workspace);
    resize();
    return () => observer.disconnect();
  }, []);

  const resizeMap = useCallback((delta: number): void => {
    const height = workspaceRef.current?.clientHeight ?? 0;
    setPaneSizes((current) => {
      const separators = showTimeline && showTable ? 14 : 7;
      const reservedTimeline = showTimeline ? current.histogram : 0;
      const tableMinimum = showTable ? 120 : 0;
      const maximum = Math.max(
        170,
        height - separators - reservedTimeline - tableMinimum,
      );
      const next = {
        ...current,
        map: Math.max(170, Math.min(maximum, current.map + delta)),
      };
      paneSizesRef.current = next;
      return next;
    });
  }, [showTable, showTimeline]);

  const resizeHistogram = useCallback((delta: number): void => {
    const height = workspaceRef.current?.clientHeight ?? 0;
    setPaneSizes((current) => {
      const maximum = showTable
        ? Math.max(150, height - 14 - current.map - 120)
        : Math.max(150, height - 7 - 170);
      const next = {
        ...current,
        histogram: Math.max(
          150,
          Math.min(maximum, current.histogram + delta),
        ),
      };
      paneSizesRef.current = next;
      return next;
    });
  }, [showTable]);

  const applySettings = (nextSettings: MapLayerSettings): void => {
    setSettings(nextSettings);
    const current = engineRef.current;
    current?.setBaseLayer(nextSettings.baseLayer);
    current?.setBaseVisible(nextSettings.baseVisible);
    current?.setBaseOpacity(nextSettings.baseOpacity);
    current?.setManagedLayers(nextSettings.managedLayers);
    current?.setCountryStrokeColor(nextSettings.countryStrokeColor);
    current?.setCountryBoundariesVisible(nextSettings.countriesVisible);
    current?.setMapBackgroundColor(nextSettings.mapBackgroundColor);
    current?.setEllipsesVisible(nextSettings.ellipsesVisible);
    current?.setSelectedEllipsesVisible(
      nextSettings.selectedEllipsesVisible,
    );
  };

  const startCsvImport = useCallback(
    (
      group: ImportGroup,
      mapping: CsvColumnMapping,
      existing?: DatasetTab,
      recovery?: PersistedCsvTab,
    ): void => {
      const worker = workerRef.current;
      if (!worker) {
        setError("The data worker is not ready yet.");
        return;
      }
      captureActiveState();
      const refreshedExisting = existing
        ? tabsRef.current.find((tab) => tab.id === existing.id)
        : undefined;
      const requestId = ++requestIdRef.current;
      const id = refreshedExisting?.id ?? ++tabIdRef.current;
      const allFiles = refreshedExisting
        ? [...refreshedExisting.files, ...group.files]
        : group.files;
      const allPersistedFiles = refreshedExisting
        ? [...refreshedExisting.persistedFiles, ...group.persistedFiles]
        : group.persistedFiles;
      const chosenColor =
        refreshedExisting?.colorField ??
        recovery?.colorField ??
        mapping.color ??
        UNIFORM_COLOR_FIELD;
      const chosenPalette =
        refreshedExisting?.colorPalette ?? recovery?.colorPalette ?? "turbo";
      const chosenColorValueMode =
        refreshedExisting?.colorValueMode ??
        recovery?.colorValueMode ??
        "categorical";
      const loadingTab: DatasetTab = {
        id,
        kind: "csv",
        schemaKey: group.schemaKey,
        title:
          refreshedExisting?.title ??
          recovery?.title ??
          tabTitle(group.files[0]),
        columns: group.columns,
        files: allFiles,
        storageId:
          refreshedExisting?.storageId ??
          recovery?.storageId ??
          datasetStorageId(),
        persistedFiles: allPersistedFiles,
        mapping: refreshedExisting?.mapping ?? mapping,
        colorField: chosenColor,
        colorPalette: chosenPalette,
        colorValueMode: chosenColorValueMode,
        dataset: refreshedExisting?.dataset ?? null,
        tableData: refreshedExisting?.tableData ?? null,
        summary: refreshedExisting?.summary ?? null,
        engineState: refreshedExisting?.engineState,
        timeFilterRange:
          refreshedExisting?.timeFilterRange ?? recovery?.timeFilterRange,
        timeViewRange: refreshedExisting?.timeViewRange ?? recovery?.timeViewRange,
        status: "loading",
      };
      replaceTabs((current) => {
        if (refreshedExisting) {
          return current.map((tab) => (tab.id === id ? loadingTab : tab));
        }
        return [...current, loadingTab];
      });
      pendingRef.current = {
        kind: "load",
        requestId,
        tabId: id,
        previousTab: refreshedExisting,
        recolorAfterLoad:
          refreshedExisting &&
          chosenColor !== UNIFORM_COLOR_FIELD
            ? chosenColor
            : undefined,
      };
      activeTabIdRef.current = id;
      setActiveTabId(id);
      if (!refreshedExisting) clearDatasetUi();
      setError(null);
      setProgress({ phase: "parsing", completed: 0, total: 1 });

      const previousDataset = refreshedExisting?.dataset;
      const previousSummary = refreshedExisting?.summary;
      const base =
        previousDataset && previousSummary
          ? appendableDataset(previousDataset, previousSummary)
          : undefined;
      const tableBase = refreshedExisting?.tableData ?? undefined;
      csvImportLog(refreshedExisting ? "append started" : "import started", {
        requestId,
        tabId: id,
        schemaKey: group.schemaKey,
        incomingFiles: group.files.map((file) => file.name),
        priorFiles: refreshedExisting?.files.map((file) => file.name) ?? [],
        priorRows: previousSummary?.rowCount ?? 0,
        priorDatasetRows: base?.x.length ?? 0,
        priorTableRows: tableBase?.rowCount ?? 0,
        totalFiles: allFiles.length,
        persistedFiles: allPersistedFiles.length,
      });
      // Let structured cloning copy append bases. Transferring these buffers
      // would detach the active map and table while the worker parses new rows.
      worker.postMessage({
        type: "parse",
        requestId,
        files: group.files,
        columns: loadingTab.mapping!,
        tableColumns: loadingTab.columns,
        colorField:
          chosenColor === UNIFORM_COLOR_FIELD ? undefined : chosenColor,
        colorPalette: chosenPalette,
        colorValueMode: chosenColorValueMode,
        base,
        tableBase,
        totalFileCount: allFiles.length,
      });
    },
    [captureActiveState, clearDatasetUi, replaceTabs],
  );
  startCsvImportRef.current = startCsvImport;

  const advanceImportQueue = useCallback((): void => {
    if (pendingRef.current || mappingGroupRef.current) return;
    if (recoveryActiveRef.current && !recoveryInitializedRef.current) return;
    const recovery = recoveryQueueRef.current.shift();
    if (recovery) {
      startCsvImportRef.current(
        recovery.group,
        recovery.tab.mapping,
        undefined,
        recovery.tab,
      );
      return;
    }
    if (recoveryActiveRef.current) {
      recoveryActiveRef.current = false;
      setPersistenceState("available");
      const recoveredActive = tabsRef.current.find(
        (tab) => tab.storageId === recoveredActiveStorageIdRef.current,
      );
      if (recoveredActive) activateTab(recoveredActive.id);
    }
    const group = importQueueRef.current.shift();
    if (!group) return;
    const existing = tabsRef.current.find(
      (tab) =>
        tab.kind === "csv" &&
        tab.schemaKey === group.schemaKey &&
        tab.status === "ready",
    );
    csvImportLog("queue advanced", {
      schemaKey: group.schemaKey,
      incomingFiles: group.files.map((file) => file.name),
      matchedTabId: existing?.id ?? null,
      matchedRows: existing?.summary?.rowCount ?? 0,
      availableTabs: tabsRef.current.map((tab) => ({
        id: tab.id,
        schemaKey: tab.schemaKey,
        status: tab.status,
        rows: tab.summary?.rowCount ?? 0,
      })),
    });
    if (existing?.mapping) {
      startCsvImportRef.current(group, existing.mapping, existing);
    } else {
      setMappingGroup(group);
    }
  }, [activateTab, setMappingGroup]);
  advanceImportQueueRef.current = advanceImportQueue;

  const handleFiles = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return;
    const canPersist = opfsSupported();
    try {
      const grouped = new Map<string, ImportGroup>();
      let persistenceFailure: string | null = null;
      if (canPersist) setPersistenceState("saving");
      for (const file of Array.from(files)) {
        let persistedFile: PersistedCsvFile | null = null;
        if (canPersist) {
          try {
            persistedFile = await persistCsvFile(file);
          } catch (caught) {
            persistenceFailure =
              caught instanceof Error ? caught.message : String(caught);
          }
        }
        const sample = await file.slice(0, 512 * 1024).text();
        const parsed = Papa.parse<string[]>(sample, {
          preview: 1,
          skipEmptyLines: true,
        });
        const columns = (parsed.data[0] ?? []).map((column, index) => {
          const normalized = String(column);
          const withoutBom =
            index === 0 ? normalized.replace(/^\uFEFF/, "") : normalized;
          return withoutBom.trim();
        });
        if (columns.length < 2) {
          throw new Error(`${file.name} has fewer than two CSV columns.`);
        }
        const key = csvSchemaKey(columns);
        const group = grouped.get(key);
        if (group) {
          group.files.push(file);
          if (persistedFile) group.persistedFiles.push(persistedFile);
        } else {
          grouped.set(key, {
            schemaKey: key,
            columns,
            files: [file],
            persistedFiles: persistedFile ? [persistedFile] : [],
          });
        }
      }
      if (canPersist) {
        setPersistenceState(persistenceFailure ? "error" : "available");
        if (persistenceFailure) {
          setError(
            `CSV loading will continue, but persistent recovery is incomplete: ${persistenceFailure}`,
          );
        }
      }
      importQueueRef.current.push(...grouped.values());
      csvImportLog("files queued", {
        opfsSupported: canPersist,
        groups: Array.from(grouped.values(), (group) => ({
          schemaKey: group.schemaKey,
          files: group.files.map((file) => file.name),
          persistedFiles: group.persistedFiles.length,
        })),
      });
      advanceImportQueueRef.current();
    } catch (caught) {
      if (canPersist) setPersistenceState("error");
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const loadMappedCsv = (mapping: CsvColumnMapping): void => {
    const group = mappingGroupRef.current;
    if (!group) return;
    setMappingGroup(null);
    startCsvImportRef.current(group, mapping);
  };

  const generate = useCallback(
    (count: number): void => {
      const worker = workerRef.current;
      if (!worker || pendingRef.current) {
        setError("Wait for the current data operation to finish.");
        return;
      }
      captureActiveState();
      const previous = tabsRef.current.find(
        (tab) => tab.schemaKey === "__synthetic__",
      );
      const id = previous?.id ?? ++tabIdRef.current;
      const requestId = ++requestIdRef.current;
      const loadingTab: DatasetTab = {
        id,
        kind: "synthetic",
        schemaKey: "__synthetic__",
        title: `Synthetic ${formatCompact(count)}`,
        columns: ["Cluster", "Timestamp"],
        files: [],
        persistedFiles: [],
        colorField: SYNTHETIC_CLUSTER_FIELD,
        colorPalette: "turbo",
        colorValueMode: "categorical",
        dataset: null,
        tableData: null,
        summary: null,
        status: "loading",
      };
      replaceTabs((current) =>
        previous
          ? current.map((tab) => (tab.id === id ? loadingTab : tab))
          : [...current, loadingTab],
      );
      pendingRef.current = {
        kind: "load",
        requestId,
        tabId: id,
        previousTab: previous,
      };
      activeTabIdRef.current = id;
      setActiveTabId(id);
      clearDatasetUi();
      setError(null);
      setProgress({ phase: "generating", completed: 0, total: count });
      worker.postMessage({
        type: "generate",
        requestId,
        count,
        chunkSize: 50_000,
        seed: 0x51a7cafe,
      });
    },
    [captureActiveState, clearDatasetUi, replaceTabs],
  );

  const changeColorField = (colorField: string): void => {
    const tab = tabsRef.current.find(
      (candidate) => candidate.id === activeTabIdRef.current,
    );
    if (!tab?.dataset || tab.status !== "ready") return;
    if (
      colorField === UNIFORM_COLOR_FIELD ||
      colorField === SYNTHETIC_CLUSTER_FIELD ||
      colorField === SYNTHETIC_TIME_FIELD
    ) {
      const colorValueMode =
        colorField === SYNTHETIC_TIME_FIELD
          ? "continuous"
          : colorField === SYNTHETIC_CLUSTER_FIELD
            ? "categorical"
            : tab.colorValueMode;
      const updated = { ...tab, colorField, colorValueMode };
      replaceTabs((current) =>
        current.map((candidate) =>
          candidate.id === tab.id ? updated : candidate,
        ),
      );
      applyColorMode(updated);
      return;
    }
    if (!tab.mapping || !tab.files.length || pendingRef.current) {
      if (pendingRef.current) {
        setError("Wait for the current data operation to finish.");
      }
      return;
    }
    const requestId = ++requestIdRef.current;
    pendingRef.current = {
      kind: "recolor",
      requestId,
      tabId: tab.id,
      colorField,
      colorPalette: tab.colorPalette,
      colorValueMode: tab.colorValueMode,
    };
    setError(null);
    setProgress({ phase: "coloring", completed: 0, total: 1 });
    workerRef.current?.postMessage({
      type: "recolor",
      requestId,
      files: tab.files,
      columns: tab.mapping,
      colorField,
      colorPalette: tab.colorPalette,
      colorValueMode: tab.colorValueMode,
    });
  };

  const changeColorValueMode = (colorValueMode: ColorValueMode): void => {
    const tab = tabsRef.current.find(
      (candidate) => candidate.id === activeTabIdRef.current,
    );
    if (
      !tab?.dataset ||
      tab.status !== "ready" ||
      tab.kind !== "csv" ||
      tab.colorField === UNIFORM_COLOR_FIELD ||
      !tab.mapping ||
      !tab.files.length ||
      pendingRef.current
    ) {
      if (pendingRef.current) {
        setError("Wait for the current data operation to finish.");
      }
      return;
    }
    const requestId = ++requestIdRef.current;
    pendingRef.current = {
      kind: "recolor",
      requestId,
      tabId: tab.id,
      colorField: tab.colorField,
      colorPalette: tab.colorPalette,
      colorValueMode,
    };
    setError(null);
    setProgress({ phase: "coloring", completed: 0, total: 1 });
    workerRef.current?.postMessage({
      type: "recolor",
      requestId,
      files: tab.files,
      columns: tab.mapping,
      colorField: tab.colorField,
      colorPalette: tab.colorPalette,
      colorValueMode,
    });
  };

  const changeColorPalette = (colorPalette: ColorPalette): void => {
    const tab = tabsRef.current.find(
      (candidate) => candidate.id === activeTabIdRef.current,
    );
    if (!tab?.dataset || tab.status !== "ready") return;
    if (
      tab.kind === "synthetic" ||
      tab.colorField === UNIFORM_COLOR_FIELD
    ) {
      const updated = { ...tab, colorPalette };
      replaceTabs((current) =>
        current.map((candidate) =>
          candidate.id === tab.id ? updated : candidate,
        ),
      );
      applyColorMode(updated);
      return;
    }
    if (!tab.mapping || !tab.files.length || pendingRef.current) {
      if (pendingRef.current) {
        setError("Wait for the current data operation to finish.");
      }
      return;
    }
    const requestId = ++requestIdRef.current;
    pendingRef.current = {
      kind: "recolor",
      requestId,
      tabId: tab.id,
      colorField: tab.colorField,
      colorPalette,
      colorValueMode: tab.colorValueMode,
    };
    setError(null);
    setProgress({ phase: "coloring", completed: 0, total: 1 });
    workerRef.current?.postMessage({
      type: "recolor",
      requestId,
      files: tab.files,
      columns: tab.mapping,
      colorField: tab.colorField,
      colorPalette,
      colorValueMode: tab.colorValueMode,
    });
  };

  workerEventHandlerRef.current = (message: DataWorkerEvent): void => {
    const pending = pendingRef.current;
    if (!pending || message.requestId !== pending.requestId) return;
    if (message.type === "progress") {
      setProgress(message.progress);
      return;
    }
    if (message.type === "complete" && pending.kind === "load") {
      const currentTab = tabsRef.current.find(
        (tab) => tab.id === pending.tabId,
      );
      if (currentTab) {
        csvImportLog("worker complete", {
          requestId: message.requestId,
          tabId: currentTab.id,
          schemaKey: currentTab.schemaKey,
          receivedRows: message.summary.rowCount,
          receivedTableRows: message.tableData?.rowCount ?? 0,
          files: currentTab.files.map((file) => file.name),
          persistedFiles: currentTab.persistedFiles.length,
        });
        const readyTab: DatasetTab = {
          ...currentTab,
          dataset: message.dataset,
          tableData: message.tableData ?? null,
          summary: message.summary,
          engineState: extendEngineState(
            pending.previousTab?.engineState,
            message.summary.rowCount,
          ),
          status: "ready",
        };
        replaceTabs((current) =>
          current.map((tab) => (tab.id === readyTab.id ? readyTab : tab)),
        );
        if (activeTabIdRef.current === readyTab.id) {
          loadTabIntoEngine(readyTab, true);
        }
        if (
          pending.recolorAfterLoad &&
          readyTab.mapping &&
          readyTab.files.length
        ) {
          const recolorRequestId = ++requestIdRef.current;
          pendingRef.current = {
            kind: "recolor",
            requestId: recolorRequestId,
            tabId: readyTab.id,
            colorField: pending.recolorAfterLoad,
            colorPalette: readyTab.colorPalette,
            colorValueMode: readyTab.colorValueMode,
          };
          setProgress({ phase: "coloring", completed: 0, total: 1 });
          workerRef.current?.postMessage({
            type: "recolor",
            requestId: recolorRequestId,
            files: readyTab.files,
            columns: readyTab.mapping,
            colorField: pending.recolorAfterLoad,
            colorPalette: readyTab.colorPalette,
            colorValueMode: readyTab.colorValueMode,
          });
          return;
        }
      }
      pendingRef.current = null;
      setProgress(null);
      window.setTimeout(() => advanceImportQueueRef.current(), 0);
      return;
    }
    if (message.type === "recolored" && pending.kind === "recolor") {
      const tab = tabsRef.current.find(
        (candidate) => candidate.id === pending.tabId,
      );
      if (tab?.dataset && message.colors.length === tab.summary?.rowCount) {
        tab.dataset.colors = message.colors;
        const updated = {
          ...tab,
          dataset: tab.dataset,
          colorField: pending.colorField,
          colorPalette: pending.colorPalette,
          colorValueMode: pending.colorValueMode,
        };
        replaceTabs((current) =>
          current.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          ),
        );
        if (activeTabIdRef.current === updated.id) {
          const orderedTabs = [updated, ...tabsRef.current.filter(
            (candidate) => candidate.id !== updated.id && candidate.dataset,
          )];
          const combinedColors = concatenate(
            orderedTabs.map((candidate) => candidate.dataset!.colors),
            Uint32Array,
          );
          const cached = combinedDatasetCache.get(updated.id);
          if (cached) cached.value.dataset.colors = combinedColors;
          engineRef.current?.setColors(combinedColors);
          engineRef.current?.setColorMode("source");
        }
      } else {
        setError("The selected color field did not match the loaded row count.");
      }
      pendingRef.current = null;
      setProgress(null);
      window.setTimeout(() => advanceImportQueueRef.current(), 0);
      return;
    }
    if (message.type === "error") {
      csvImportLog("worker error", {
        requestId: message.requestId,
        tabId: pending.tabId,
        operation: pending.kind,
        message: message.message,
        recoveredDatasetRows: message.recoveredBase?.x.length ?? 0,
        recoveredTableRows: message.recoveredTableBase?.rowCount ?? 0,
      });
      if (pending.kind === "load") {
        if (pending.previousTab) {
          const restored = pending.previousTab;
          if (message.recoveredBase && restored.dataset) {
            restored.dataset.x = message.recoveredBase.x;
            restored.dataset.y = message.recoveredBase.y;
            restored.dataset.semiMajor = message.recoveredBase.semiMajor;
            restored.dataset.semiMinor = message.recoveredBase.semiMinor;
            restored.dataset.rotation = message.recoveredBase.rotation;
            restored.dataset.time = message.recoveredBase.time;
            restored.dataset.colors = message.recoveredBase.colors;
            restored.dataset.extent = message.recoveredBase.extent;
          }
          if (message.recoveredTableBase) {
            restored.tableData = message.recoveredTableBase;
          }
          replaceTabs((current) =>
            current.map((tab) =>
              tab.id === pending.tabId ? restored : tab,
            ),
          );
          if (activeTabIdRef.current === restored.id) {
            loadTabIntoEngine(restored);
          }
        } else {
          const remaining = replaceTabs((current) =>
            current.filter((tab) => tab.id !== pending.tabId),
          );
          const fallback = remaining[remaining.length - 1];
          activeTabIdRef.current = fallback?.id ?? null;
          setActiveTabId(fallback?.id ?? null);
          loadTabIntoEngine(fallback);
        }
      }
      pendingRef.current = null;
      setProgress(null);
      setError(message.message);
      window.setTimeout(() => advanceImportQueueRef.current(), 0);
    }
  };

  const applyTimeRange = (start: number, end: number): void => {
    combinedTimeRangeRef.current = [start, end];
    setTimeStart(start);
    setTimeEnd(end);
    const id = activeTabIdRef.current;
    if (id != null) {
      replaceTabs((current) =>
        current.map((tab) =>
          tab.kind === "csv" ? {...tab, timeFilterRange: [start, end]} : tab,
        ),
      );
    }
    if (!engineRef.current) return;
    engineRef.current.setTimeRange(start, end);
    const activeRows = activeTab?.summary?.rowCount ?? rowCount;
    setVisibleIndices(
      engineRef.current.visibleCount === engineRef.current.count
        ? null
        : engineRef.current.visibleIndices().filter((index) => index < activeRows),
    );
  };

  const applyTimeViewRange = (start: number, end: number): void => {
    setTimeViewStart(start);
    setTimeViewEnd(end);
    const id = activeTabIdRef.current;
    if (id == null) return;
    replaceTabs((current) =>
      current.map((tab) =>
        tab.kind === "csv" ? {...tab, timeViewRange: [start, end]} : tab,
      ),
    );
  };

  const exportSelection = (): void => {
    if (!engineRef.current || selection.count === 0 || !activeTab) return;
    const tableColumns = new Map(
      (activeTab.tableData?.columns ?? []).map((column) => [
        column.name,
        column,
      ]),
    );
    const exportColumns =
      activeTab.kind === "synthetic"
        ? [
            "index",
            "latitude",
            "longitude",
            "timestamp",
            "semi_major_m",
            "semi_minor_m",
            "tilt_deg",
          ]
        : activeTab.columns;
    const mapping = activeTab.mapping;
    const lines = [exportColumns.map(csvCell).join(",")];
    for (const index of engineRef.current.selectedIndices()) {
      if (activeTab.summary && index >= activeTab.summary.rowCount) continue;
      const row = engineRef.current.row(index);
      const mappedValue = (column: string): string | number => {
        if (activeTab.kind === "synthetic") {
          if (column === "index") return row.index;
          if (column === "latitude") return row.latitude;
          if (column === "longitude") return row.longitude;
          if (column === "timestamp") {
            return Number.isFinite(row.time)
              ? new Date(row.time * 1000).toISOString()
              : "";
          }
          if (column === "semi_major_m") return row.semiMajor;
          if (column === "semi_minor_m") return row.semiMinor;
          if (column === "tilt_deg") return row.tilt;
        }
        if (column === mapping?.latitude) return row.latitude;
        if (column === mapping?.longitude) return row.longitude;
        if (column === mapping?.time) {
          return Number.isFinite(row.time)
            ? new Date(row.time * 1000).toISOString()
            : "";
        }
        if (column === mapping?.semiMajor) return row.semiMajor;
        if (column === mapping?.semiMinor) return row.semiMinor;
        if (column === mapping?.tilt) return row.tilt;
        const tableColumn = tableColumns.get(column);
        return tableColumn ? tableColumnValue(tableColumn, index) : "";
      };
      lines.push(
        exportColumns.map((column) => csvCell(mappedValue(column))).join(","),
      );
    }
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/csv" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "selected-points.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const findRow = (): void => {
    const index = Number.parseInt(findValue, 10);
    if (
      !engineRef.current ||
      !Number.isFinite(index) ||
      index < 0 ||
      index >= rowCount
    ) {
      setError("Enter a valid source row index.");
      return;
    }
    engineRef.current.selectIndices([index], true);
    setFindValue("");
  };

  const updateVisibility = (
    action: (current: FastPointEngine) => void,
  ): void => {
    const current = engineRef.current;
    if (!current) return;
    action(current);
    const activeRows = tabsRef.current.find(
      (tab) => tab.id === activeTabIdRef.current,
    )?.summary?.rowCount ?? rowCount;
    setVisibleIndices(
      current.visibleCount === current.count
        ? null
        : current.visibleIndices().filter((index) => index < activeRows),
    );
  };

  const showAllRows = (): void => {
    updateVisibility((current) => current.showAll());
    setTimeStart(timeMinimum);
    setTimeEnd(timeMaximum);
    const id = activeTabIdRef.current;
    if (id == null) return;
    replaceTabs((current) =>
      current.map((tab) => {
        if (tab.id !== id) return tab;
        const {timeFilterRange: _discarded, ...withoutTimeFilter} = tab;
        return withoutTimeFilter;
      }),
    );
  };

  const forgetSavedWorkspace = async (): Promise<void> => {
    if (
      !window.confirm(
        "Clear the saved LeySight workspace and unload all current datasets?",
      )
    ) {
      return;
    }
    try {
      setPersistenceState("saving");
      await clearPersistedWorkspace();
      importQueueRef.current = [];
      recoveryQueueRef.current = [];
      replaceTabs(() => []);
      activeTabIdRef.current = null;
      setActiveTabId(null);
      clearDatasetUi();
      setPersistenceState("available");
    } catch (caught) {
      setPersistenceState("error");
      setError(
        `Unable to clear the saved workspace: ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );
    }
  };

  const toggleDarkMode = (): void => {
    const enabled = !darkMode;
    setDarkMode(enabled);
    applySettings({
      ...settings,
      countryStrokeColor: enabled ? "#64748b" : "#334155",
      mapBackgroundColor: enabled ? "#0f172a" : "#ffffff",
    });
  };

  const progressRatio =
    progress && progress.total > 0
      ? Math.min(1, progress.completed / progress.total)
      : 0;
  const workspaceRows = showTimeline && showTable
    ? `${paneSizes.map}px 7px ${paneSizes.histogram}px 7px minmax(120px, 1fr)`
    : showTimeline
      ? `minmax(170px, 1fr) 7px ${paneSizes.histogram}px 36px`
      : showTable
        ? `${paneSizes.map}px 36px 7px minmax(120px, 1fr)`
        : "minmax(0, 1fr) 36px 36px";

  return (
    <div className={darkMode ? "app theme-dark" : "app theme-light"}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        multiple
        hidden
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <header className="app-header">
        <div className="brand">
          <span className="brand-mark"><MapPinned size={19} /></span>
          <div>
            <strong>LeySight</strong>
            <span>local-first geospatial analysis</span>
          </div>
        </div>
        <nav className="menu-bar" aria-label="Application menu">
          <details className="app-menu">
            <summary>File</summary>
            <div className="app-menu-popover" role="menu">
              <button
                role="menuitem"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  fileInputRef.current?.click();
                }}
              >
                Load CSV(s)…
              </button>
              <button
                role="menuitem"
                disabled={!selection.count}
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  exportSelection();
                }}
              >
                Save Selected
              </button>
              <div className="menu-separator" />
              <button
                role="menuitem"
                disabled={persistenceState === "unavailable"}
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  void forgetSavedWorkspace();
                }}
              >
                Clear Saved Workspace…
              </button>
            </div>
          </details>
          <details className="app-menu">
            <summary>Map</summary>
            <div className="app-menu-popover map-menu-popover" role="menu">
              <button
                role="menuitemcheckbox"
                aria-checked={darkMode}
                onClick={toggleDarkMode}
              >
                <span className="menu-check">{darkMode ? "✓" : ""}</span>
                Dark Mode
              </button>
              <div className="menu-separator" />
              <button
                role="menuitem"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  setShowSettings(true);
                }}
              >
                Base/WMS Settings…
              </button>
              <div className="menu-separator" />
              <button
                role="menuitemcheckbox"
                aria-checked={settings.baseVisible}
                onClick={() =>
                  applySettings({...settings, baseVisible: !settings.baseVisible})
                }
              >
                <span className="menu-check">{settings.baseVisible ? "✓" : ""}</span>
                Show OSM/XYZ Base
              </button>
              <button
                role="menuitemcheckbox"
                aria-checked={settings.managedLayers.some(
                  (layer) => layer.type === "wms" && layer.visible,
                )}
                onClick={(event) => {
                  const hasWms = settings.managedLayers.some(
                    (layer) => layer.type === "wms",
                  );
                  if (!hasWms) {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setShowSettings(true);
                    return;
                  }
                  const visible = settings.managedLayers.some(
                    (layer) => layer.type === "wms" && layer.visible,
                  );
                  applySettings({
                    ...settings,
                    managedLayers: settings.managedLayers.map((layer) =>
                      layer.type === "wms"
                        ? {...layer, visible: !visible}
                        : layer,
                    ),
                  });
                }}
              >
                <span className="menu-check">
                  {settings.managedLayers.some(
                    (layer) => layer.type === "wms" && layer.visible,
                  ) ? "✓" : ""}
                </span>
                Show WMS Overlay
              </button>
              <button
                role="menuitemcheckbox"
                aria-checked={settings.countriesVisible}
                onClick={() =>
                  applySettings({
                    ...settings,
                    countriesVisible: !settings.countriesVisible,
                  })
                }
              >
                <span className="menu-check">
                  {settings.countriesVisible ? "✓" : ""}
                </span>
                Show Countries
              </button>
              <label className="menu-color-row">
                <span>Country Stroke Color…</span>
                <input
                  type="color"
                  aria-label="Country stroke color"
                  value={settings.countryStrokeColor}
                  onChange={(event) =>
                    applySettings({
                      ...settings,
                      countryStrokeColor: event.target.value,
                    })
                  }
                />
              </label>
              <label className="menu-color-row">
                <span>Background Color…</span>
                <input
                  type="color"
                  aria-label="Map background color"
                  value={settings.mapBackgroundColor}
                  onChange={(event) =>
                    applySettings({
                      ...settings,
                      mapBackgroundColor: event.target.value,
                    })
                  }
                />
              </label>
              <div className="menu-separator" />
              <button
                role="menuitemcheckbox"
                aria-checked={settings.ellipsesVisible}
                onClick={() =>
                  applySettings({
                    ...settings,
                    ellipsesVisible: !settings.ellipsesVisible,
                  })
                }
              >
                <span className="menu-check">
                  {settings.ellipsesVisible ? "✓" : ""}
                </span>
                Show Ellipses
              </button>
            </div>
          </details>
          <details className="app-menu">
            <summary>Selection</summary>
            <div className="app-menu-popover" role="menu">
              <button
                role="menuitem"
                disabled={!selection.count}
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  updateVisibility((current) => current.showOnlySelection());
                }}
              >
                Show Only Selected
              </button>
              <button
                role="menuitem"
                disabled={!selection.count}
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  updateVisibility((current) => current.hideSelection());
                }}
              >
                Hide Selected
              </button>
              <button
                role="menuitem"
                disabled={!rowCount}
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  showAllRows();
                }}
              >
                Show All
              </button>
            </div>
          </details>
        </nav>
        <div className="header-status">
          <span
            className={`privacy-pill persistence-${persistenceState}`}
            title="Raw CSV files and workspace metadata are stored locally in OPFS."
          >
            {persistenceLabel(persistenceState)}
          </span>
          <button
            className="icon-button"
            aria-label={darkMode ? "Use light mode" : "Use dark mode"}
            onClick={toggleDarkMode}
          >
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="icon-button"
            aria-label="Map settings"
            onClick={() => setShowSettings(true)}
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <button
            className="tool-button primary-tool"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={16} /> Load CSV
          </button>
          <button
            className="tool-button"
            onClick={() => engineRef.current?.fitToData()}
            disabled={!rowCount}
          >
            <Focus size={16} /> Fit data
          </button>
          <button
            className={`tool-button ${measurementEnabled ? "is-active" : ""}`}
            aria-pressed={measurementEnabled}
            onClick={() => {
              const enabled = !measurementEnabled;
              setMeasurementEnabled(enabled);
              engineRef.current?.setMeasurementEnabled(enabled);
            }}
          >
            <Ruler size={16} /> Measure
          </button>
          {measurement.pointCount > 0 && (
            <button
              className="tool-button"
              onClick={() => engineRef.current?.clearMeasurements()}
            >
              Clear measure
            </button>
          )}
          <button
            className="tool-button"
            onClick={() => setShowSettings(true)}
          >
            <Layers size={16} /> Layers
          </button>
        </div>
        <div className="tool-divider" />
        <label className="toolbar-field">
          <span>Color by</span>
          <select
            value={activeTab?.colorField ?? UNIFORM_COLOR_FIELD}
            disabled={!activeTab?.dataset || Boolean(pendingRef.current)}
            onChange={(event) => changeColorField(event.target.value)}
          >
            <option value={UNIFORM_COLOR_FIELD}>Uniform</option>
            {activeTab?.kind === "synthetic" ? (
              <>
                <option value={SYNTHETIC_CLUSTER_FIELD}>Cluster</option>
                <option value={SYNTHETIC_TIME_FIELD}>Timestamp</option>
              </>
            ) : (
              activeTab?.columns.map((column) => (
                <option value={column} key={column}>
                  {column}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="toolbar-field">
          <span>Treat as</span>
          <select
            value={activeTab?.colorValueMode ?? "categorical"}
            disabled={
              !activeTab?.dataset ||
              activeTab.kind !== "csv" ||
              activeTab.colorField === UNIFORM_COLOR_FIELD ||
              Boolean(pendingRef.current)
            }
            onChange={(event) =>
              changeColorValueMode(event.target.value as ColorValueMode)
            }
            title="Categories assigns distinct values; Continuous scales numeric or timestamp values."
          >
            {COLOR_VALUE_MODES.map((mode) => (
              <option value={mode.value} key={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar-field palette-field">
          <span>Gradient</span>
          <i
            className="palette-swatch"
            style={{
              background: paletteCss(activeTab?.colorPalette ?? "turbo"),
            }}
          />
          <select
            value={activeTab?.colorPalette ?? "turbo"}
            disabled={
              !activeTab?.dataset ||
              Boolean(pendingRef.current) ||
              activeTab.colorField === UNIFORM_COLOR_FIELD ||
              (activeTab.kind === "synthetic" &&
                activeTab.colorField === SYNTHETIC_CLUSTER_FIELD)
            }
            onChange={(event) =>
              changeColorPalette(event.target.value as ColorPalette)
            }
          >
            {COLOR_PALETTES.map((palette) => (
              <option value={palette.value} key={palette.value}>
                {palette.label}
              </option>
            ))}
          </select>
        </label>
        <div className="tool-divider" />
        <label className="toolbar-field find-field">
          <span>Find row</span>
          <input
            value={findValue}
            inputMode="numeric"
            placeholder="Source index"
            onChange={(event) => setFindValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") findRow();
            }}
          />
          <button onClick={findRow}>Find</button>
        </label>
        <div className="toolbar-spacer" />
        <div className="tool-group">
          <button
            className="tool-button"
            disabled={!selection.count}
            onClick={exportSelection}
          >
            <Download size={16} /> Save selected
          </button>
          <button
            className="tool-button"
            disabled={!selection.count}
            onClick={() =>
              updateVisibility((current) => current.hideSelection())
            }
          >
            <EyeOff size={16} /> Hide
          </button>
          <button
            className="tool-button"
            disabled={!rowCount}
            onClick={() => {
              showAllRows();
            }}
          >
            <Eye size={16} /> Show all
          </button>
          <button
            className="tool-button danger"
            disabled={!selection.count}
            onClick={() =>
              updateVisibility((current) => current.deleteSelection())
            }
          >
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </div>

      <div className="activity-slot">
        {(progress || error) && (
          <div className={`activity-banner ${error ? "error" : ""}`}>
            {error ? (
              <>
                <span>{error}</span>
                <button
                  aria-label="Dismiss error"
                  onClick={() => setError(null)}
                >
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                <Database size={15} />
                <span>
                  {progress?.phase === "parsing"
                    ? "Parsing local CSV"
                    : progress?.phase === "indexing"
                      ? "Building compact spatial index"
                      : progress?.phase === "coloring"
                        ? "Coloring from CSV field"
                        : "Generating synthetic data"}
                </span>
                <div className="progress-track">
                  <span style={{ width: `${progressRatio * 100}%` }} />
                </div>
                <strong>{Math.round(progressRatio * 100)}%</strong>
              </>
            )}
          </div>
        )}
      </div>

      <main
        className="workspace"
        ref={workspaceRef}
        style={{
          gridTemplateRows: workspaceRows,
        }}
      >
        <section className="map-panel">
          <MapPanel
            onEngine={handleEngine}
            onSelectionChange={handleSelectionChange}
            onMetrics={setMetrics}
            onPointerCoordinate={setPointer}
            onMeasurementChange={setMeasurement}
          />
          <div className="map-stats">
            <span><strong>{formatCompact(metrics.totalPoints)}</strong> indexed</span>
            <span><strong>{formatCompact(metrics.visiblePoints)}</strong> visible</span>
            <span><strong>{formatCompact(metrics.drawnPoints)}</strong> drawn</span>
            <span><strong>{metrics.renderMs.toFixed(1)} ms</strong> render</span>
          </div>
          {settings.coordinatesVisible && (
            <div className="coordinates">
              {pointer
                ? `${pointer[1].toFixed(5)}, ${pointer[0].toFixed(5)}`
                : "Move over map"}
            </div>
          )}
          <div className="map-help">
            {measurementEnabled
              ? "Click to measure · double-click to finish"
              : "Click to select · Ctrl/Cmd-drag for box selection"}
          </div>
          {measurement.pointCount > 0 && (
            <div className="measurement-summary">
              <strong>{formatDistance(measurement.totalMeters)}</strong>
              <span>
                {measurement.segmentMeters.length.toLocaleString()} segments
              </span>
              <ol>
                {measurement.segmentMeters.map((meters, index) => (
                  <li key={index}>
                    <span>Segment {index + 1}</span>
                    <strong>{formatDistance(meters)}</strong>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        {showTimeline && (
          <PaneSeparator
            label="Resize map and timeline"
            onDrag={
              !showTable
                ? (delta) => resizeHistogram(-delta)
                : resizeMap
            }
            onStep={
              !showTable
                ? (delta) => resizeHistogram(-delta)
                : resizeMap
            }
          />
        )}

        {showTimeline && (
          // Keep one time control mounted while its active dataset changes.
          <HistogramRange
            bins={timeHistogram}
            minimum={timeMinimum}
            maximum={timeMaximum}
            start={timeStart}
            end={timeEnd}
            viewStart={timeViewStart}
            viewEnd={timeViewEnd}
            disabled={
              !summary ||
              !Number.isFinite(summary.timeMin) ||
              !Number.isFinite(summary.timeMax) ||
              summary.timeMax <= summary.timeMin
            }
            onChange={applyTimeRange}
            onViewChange={applyTimeViewRange}
            onCollapse={() => setShowTimeline(false)}
          />
        )}

        {!showTimeline && (
          <button
            className="collapsed-drawer"
            type="button"
            aria-label="Expand time activity"
            onClick={() => setShowTimeline(true)}
          >
            <ChartNoAxesColumn size={15} />
            <span>Time Activity</span>
            <PanelBottomOpen size={16} />
          </button>
        )}

        {showTable && (
          <PaneSeparator
            label={showTimeline
              ? "Resize timeline and feature table"
              : "Resize map and feature table"}
            onDrag={showTimeline ? resizeHistogram : resizeMap}
            onStep={showTimeline ? resizeHistogram : resizeMap}
          />
        )}

        {showTable && (
          <div className="table-workspace">
            <nav className="dataset-tabs" role="tablist" aria-label="CSV data tables">
              <span className="dataset-tabs-label" aria-hidden="true">TABLES</span>
              {tabs.map((tab, index) => (
                <button
                  key={tab.id}
                  id={`dataset-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeTabId}
                  aria-controls={`dataset-table-panel-${tab.id}`}
                  aria-label={`Table ${index + 1}: ${tab.title}`}
                  className={tab.id === activeTabId ? "is-active" : ""}
                  onClick={() => activateTab(tab.id)}
                >
                  <span>
                    <strong>TABLE {index + 1}</strong>
                    {tab.title}
                  </span>
                  <small>
                    {tab.status === "loading"
                      ? "loading"
                      : formatCompact(tab.summary?.rowCount ?? 0)}
                  </small>
                </button>
              ))}
            </nav>
            <VirtualDataTable
              key={activeTabId ?? "empty"}
              panelId={activeTab ? `dataset-table-panel-${activeTab.id}` : undefined}
              labelledBy={activeTab ? `dataset-tab-${activeTab.id}` : undefined}
              engine={engine}
              rowCount={rowCount}
              columns={activeTab?.columns ?? []}
              mapping={activeTab?.mapping}
              tableData={activeTab?.tableData ?? null}
              visibleIndices={visibleIndices}
              selectionRevision={selection.revision}
              onCollapse={() => setShowTable(false)}
              onSelectRow={(index, toggle) => {
                if (toggle) engineRef.current?.toggleIndex(index);
                else engineRef.current?.selectIndices([index], true);
              }}
            />
          </div>
        )}
        {!showTable && (
          <button
            className="collapsed-drawer"
            type="button"
            aria-label="Expand feature table"
            onClick={() => setShowTable(true)}
          >
            <Table2 size={15} />
            <span>
              Feature Table
              {engine?.selectionCount
                ? ` · ${engine.selectionCount.toLocaleString()} selected`
                : ""}
            </span>
            <PanelBottomOpen size={16} />
          </button>
        )}
      </main>

      <footer className="status-bar">
        <span>{summary?.name ?? "No dataset loaded"}</span>
        <span>
          {summary
            ? `${summary.rowCount.toLocaleString()} rows · ${(summary.coordinateFailures ?? 0).toLocaleString()} coordinate failures · ${(summary.projectionClampedRows ?? 0).toLocaleString()} projection-clamped · ${summary.invalidRows.toLocaleString()} other invalid · ${(summary.invalidTimestamps ?? 0).toLocaleString()} invalid timestamps`
            : "Choose Load CSV to begin"}
        </span>
        <span className="status-spacer" />
        <span>
          OpenLayers 10.10 · typed-array engine · {persistenceLabel(persistenceState)}
        </span>
      </footer>

      {mappingGroup && (
        <CsvMappingDialog
          files={mappingGroup.files}
          columns={mappingGroup.columns}
          detectionRules={appConfig.csvColumnDetection}
          onCancel={() => {
            setMappingGroup(null);
            window.setTimeout(() => advanceImportQueueRef.current(), 0);
          }}
          onConfirm={loadMappedCsv}
        />
      )}
      {showSettings && (
        <LayerManagerDialog
          baseLayers={appConfig.baseLayers}
          wmsPresets={appConfig.wmsPresets}
          settings={settings}
          onChange={applySettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
