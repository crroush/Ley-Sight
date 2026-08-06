/** Supported dataset types and data transformation helpers. */
export type {
  AppendableDataset,
  CategoricalTableColumn,
  CompactSpatialIndex,
  DatasetSummary,
  EngineDatasetState,
  EngineSelectionState,
  NumericTableColumn,
  PackedDataset,
  PackedTableColumn,
  PackedTableData,
  TableRow,
} from '../lib/types';
export {
  COLOR_PALETTES,
  gradientColor,
  paletteCss,
  type ColorPalette,
} from '../lib/colorPalettes';
export {
  aggregateTimeHistogram,
  buildFineTimeHistogram,
  clampTimeRange,
  formatFullTimestamp,
  formatTimeAxisTick,
  moveFixedTimeWindow,
  type TimeRange,
} from '../lib/timeHistogram';
export {mergePackedTableData} from '../lib/tableData';
export {parseTimestamp, formatTimestampPreview} from '../lib/timestamps';
