import type { ColorPalette } from "./colorPalettes";
import type { ColorValueMode } from "./colorValueModes";

export type DatasetSummary = {
  name: string;
  rowCount: number;
  timeMin: number;
  timeMax: number;
  invalidRows: number;
};

export type NumericTableColumn = {
  kind: "number";
  name: string;
  values: Float64Array<ArrayBuffer>;
};

export type CategoricalTableColumn = {
  kind: "category";
  name: string;
  codes: Uint32Array<ArrayBuffer>;
  dictionary: string[];
};

export type PackedTableColumn =
  | NumericTableColumn
  | CategoricalTableColumn;

/**
 * Compact storage for CSV fields that are not already present in the geometry
 * engine. Numeric columns use 64-bit arrays; text uses dictionary codes.
 */
export type PackedTableData = {
  rowCount: number;
  columns: PackedTableColumn[];
};

export type EngineDatasetState = {
  visible: Uint8Array<ArrayBuffer>;
  deleted: Uint8Array<ArrayBuffer>;
  selected: Uint8Array<ArrayBuffer>;
  timeRange: [number, number];
};

export type EngineSelectionState = {
  count: number;
  revision: number;
};

export type MeasurementState = {
  pointCount: number;
  segmentMeters: number[];
  totalMeters: number;
};

export type CompactSpatialIndex = {
  order: Uint32Array<ArrayBuffer>;
  nodeStart: Uint32Array<ArrayBuffer>;
  nodeEnd: Uint32Array<ArrayBuffer>;
  nodeFirstIndex: Uint32Array<ArrayBuffer>;
  nodeChildren: Int32Array<ArrayBuffer>;
  nodeMinX: Float64Array<ArrayBuffer>;
  nodeMinY: Float64Array<ArrayBuffer>;
  nodeMaxX: Float64Array<ArrayBuffer>;
  nodeMaxY: Float64Array<ArrayBuffer>;
};

export type PackedDataset = {
  x: Float64Array<ArrayBuffer>;
  y: Float64Array<ArrayBuffer>;
  semiMajor: Float32Array<ArrayBuffer>;
  semiMinor: Float32Array<ArrayBuffer>;
  rotation: Float32Array<ArrayBuffer>;
  time: Float64Array<ArrayBuffer>;
  colors: Uint32Array<ArrayBuffer>;
  timeHistogram: Uint32Array<ArrayBuffer>;
  extent: [number, number, number, number];
  index: CompactSpatialIndex;
};

export type AppendableDataset = Pick<
  PackedDataset,
  "x" | "y" | "semiMajor" | "semiMinor" | "rotation" | "time" | "colors" | "extent"
> & {
  invalidRows: number;
  timeMin: number;
  timeMax: number;
};

export type WorkerProgress = {
  phase: "generating" | "parsing" | "indexing" | "coloring";
  completed: number;
  total: number;
};

export type DataWorkerMessage =
  | { type: "reset"; requestId: number }
  | {
      type: "generate";
      requestId: number;
      count: number;
      chunkSize: number;
      seed: number;
    }
  | {
      type: "parse";
      requestId: number;
      files: File[];
      columns: CsvColumnMapping;
      tableColumns: string[];
      colorField?: string;
      colorPalette: ColorPalette;
      colorValueMode: ColorValueMode;
      base?: AppendableDataset;
      tableBase?: PackedTableData;
      totalFileCount: number;
    }
  | {
      type: "recolor";
      requestId: number;
      files: File[];
      columns: CsvColumnMapping;
      colorField: string;
      colorPalette: ColorPalette;
      colorValueMode: ColorValueMode;
    };

export type DataWorkerEvent =
  | { type: "reset"; requestId: number }
  | { type: "progress"; requestId: number; progress: WorkerProgress }
  | {
      type: "complete";
      requestId: number;
      summary: DatasetSummary;
      dataset: PackedDataset;
      tableData?: PackedTableData;
    }
  | {
      type: "recolored";
      requestId: number;
      colorField: string;
      colors: Uint32Array<ArrayBuffer>;
    }
  | {
      type: "error";
      requestId: number;
      message: string;
      recoveredBase?: AppendableDataset;
      recoveredTableBase?: PackedTableData;
    };

export type CsvColumnMapping = {
  latitude: string;
  longitude: string;
  time?: string;
  semiMajor?: string;
  semiMinor?: string;
  tilt?: string;
  color?: string;
};

export type TableRow = {
  index: number;
  latitude: number;
  longitude: number;
  time: number;
  semiMajor: number;
  semiMinor: number;
  tilt: number;
};

export type BaseLayerDefinition = {
  id: string;
  name: string;
  type: "osm" | "xyz";
  url?: string;
  attribution?: string;
  maxZoom?: number;
};

export type ManagedLayerDefinition = {
  id: string;
  name: string;
  type: "wms" | "xyz";
  url: string;
  layers?: string;
  attribution?: string;
  opacity: number;
  visible: boolean;
};

export type MapLayerSettings = {
  baseLayer: BaseLayerDefinition;
  baseVisible: boolean;
  baseOpacity: number;
  managedLayers: ManagedLayerDefinition[];
  countriesVisible: boolean;
  countryStrokeColor: string;
  mapBackgroundColor: string;
  coordinatesVisible: boolean;
  ellipsesVisible: boolean;
  selectedEllipsesVisible: boolean;
};

export type RenderMetrics = {
  totalPoints: number;
  visiblePoints: number;
  visitedNodes: number;
  collapsedNodes: number;
  drawnPoints: number;
  drawnEllipses: number;
  renderMs: number;
};
