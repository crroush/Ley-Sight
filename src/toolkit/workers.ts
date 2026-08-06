/** Reusable worker-side algorithms; worker entry files are internal. */
export {
  categoricalFieldColor,
  FieldColorBuilder,
  inferFieldColorMode,
  numericFieldColor,
  resolveFieldColorMode,
  type FieldColorMode,
} from '../workers/fieldColors';
export {
  TableColumnBuilder,
  tableColumnTransferList,
  tableColumnValue,
} from '../workers/tableColumns';
export {
  continuousExtentX,
  latToMercatorY,
  lonToMercatorX,
  planBufferedViewportRasterGrid,
  type GridSpec,
} from '../workers/grid';
