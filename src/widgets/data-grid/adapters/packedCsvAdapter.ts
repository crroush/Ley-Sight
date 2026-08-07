import {useEffect, useMemo, useRef} from 'react';
import type {
  CsvColumnMapping,
  PackedTableColumn,
  PackedTableData,
  TableRow,
} from '../../../lib/types';
import type {FastPointEngine} from '../../../map/FastPointEngine';
import type {
  DataGridColumn,
  DataGridRowSource,
  DataGridSortRequest,
} from '../DataGrid';

export const SOURCE_INDEX_COLUMN = '__source_index__';

type SortResult = {
  type: 'result';
  requestId: number;
  indices: Uint32Array<ArrayBuffer>;
};

export interface PackedCsvAdapter {
  columns: readonly DataGridColumn<number>[];
  rowSource: DataGridRowSource<number>;
}

function formatNumber(value: number, digits = 3): string {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, {maximumFractionDigits: digits})
    : '—';
}

function displayWidth(column: string, mapping?: CsvColumnMapping): number {
  if (column === mapping?.time) return 210;
  if (
    column === mapping?.latitude ||
    column === mapping?.longitude ||
    column === mapping?.semiMajor ||
    column === mapping?.semiMinor
  )
    return 132;
  return Math.max(120, Math.min(260, 82 + column.length * 7));
}

function semanticValue(
  column: string,
  mapping: CsvColumnMapping | undefined,
  row: TableRow
): string | undefined {
  if (column === mapping?.latitude) return formatNumber(row.latitude, 7);
  if (column === mapping?.longitude) return formatNumber(row.longitude, 7);
  if (column === mapping?.time)
    return Number.isFinite(row.time)
      ? new Date(row.time * 1000).toISOString()
      : '—';
  if (column === mapping?.semiMajor) return formatNumber(row.semiMajor, 3);
  if (column === mapping?.semiMinor) return formatNumber(row.semiMinor, 3);
  if (column === mapping?.tilt) return formatNumber(row.tilt, 3);
  return undefined;
}

function customValue(column: PackedTableColumn | undefined, index: number) {
  if (!column) return '—';
  if (column.kind === 'number') return formatNumber(column.values[index], 8);
  return column.dictionary[column.codes[index]] ?? '';
}

function numericSortSource(
  column: string | number,
  mapping: CsvColumnMapping | undefined,
  engine: FastPointEngine,
  rowCount: number
): {
  values: Float64Array<ArrayBuffer> | Float32Array<ArrayBuffer>;
  invert: boolean;
} | null {
  const snapshot = engine.snapshot;
  if (column === mapping?.latitude)
    return {values: snapshot.y.slice(0, rowCount), invert: false};
  if (column === mapping?.longitude)
    return {values: snapshot.x.slice(0, rowCount), invert: false};
  if (column === mapping?.time)
    return {values: snapshot.time.slice(0, rowCount), invert: false};
  if (column === mapping?.semiMajor)
    return {values: snapshot.sma.slice(0, rowCount), invert: false};
  if (column === mapping?.semiMinor)
    return {values: snapshot.smi.slice(0, rowCount), invert: false};
  if (column === mapping?.tilt)
    return {values: snapshot.tilt.slice(0, rowCount), invert: true};
  return null;
}

/** Builds the CSV composition while keeping packed storage and workers out of DataGrid. */
export function usePackedCsvAdapter({
  engine,
  rowCount,
  columnNames,
  mapping,
  tableData,
  visibleIndices,
}: {
  engine: FastPointEngine | null;
  rowCount: number;
  columnNames: readonly string[];
  mapping?: CsvColumnMapping;
  tableData: PackedTableData | null;
  visibleIndices: Uint32Array | null;
}): PackedCsvAdapter {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingRef = useRef(
    new Map<number, (indices: ArrayLike<number>) => void>()
  );
  const customColumns = useMemo(
    () =>
      new Map(
        (tableData?.columns ?? []).map((column) => [column.name, column])
      ),
    [tableData]
  );

  useEffect(() => {
    const worker = new Worker(
      new URL('../../../workers/tableSort.worker.ts', import.meta.url),
      {type: 'module'}
    );
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<SortResult>) => {
      if (event.data.type !== 'result') return;
      pendingRef.current.get(event.data.requestId)?.(event.data.indices);
      pendingRef.current.delete(event.data.requestId);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingRef.current.clear();
    };
  }, []);

  const columns = useMemo<readonly DataGridColumn<number>[]>(
    () => [
      {
        key: SOURCE_INDEX_COLUMN,
        label: 'Source row',
        width: 96,
        renderCell: (index: number) => index.toLocaleString(),
      },
      ...columnNames.map((column) => ({
        key: column,
        label: column,
        width: displayWidth(column, mapping),
        renderCell: (index: number) => {
          if (!engine) return '—';
          return (
            semanticValue(column, mapping, engine.row(index)) ??
            customValue(customColumns.get(column), index)
          );
        },
      })),
    ],
    [columnNames, customColumns, engine, mapping]
  );

  const rowSource = useMemo<DataGridRowSource<number>>(
    () => ({
      rowCount: visibleIndices?.length ?? rowCount,
      rowIdAt: (position) => visibleIndices?.[position] ?? position,
      positionOf: (index) =>
        visibleIndices ? visibleIndices.indexOf(index) : index,
      revision: visibleIndices ?? rowCount,
      refreshSort: async (): Promise<ArrayLike<number>> => {
        const worker = workerRef.current;
        if (!worker || !engine || !rowCount) return [];
        const requestId = ++requestIdRef.current;
        const visible = visibleIndices?.slice() as
          | Uint32Array<ArrayBuffer>
          | undefined;
        const result = new Promise<ArrayLike<number>>((resolve) =>
          pendingRef.current.set(requestId, resolve)
        );
        worker.postMessage(
          {
            type: 'filter',
            requestId,
            focusIndex: engine.selectionFocusIndex,
            visibleIndices: visible ?? null,
          },
          visible ? [visible.buffer] : []
        );
        return result;
      },
      sort: async (
        request: DataGridSortRequest
      ): Promise<ArrayLike<number>> => {
        const worker = workerRef.current;
        if (!worker || !engine || !rowCount) return [];
        const requestId = ++requestIdRef.current;
        const visible = visibleIndices?.slice() as
          | Uint32Array<ArrayBuffer>
          | undefined;
        const transfer: Transferable[] = visible ? [visible.buffer] : [];
        const result = new Promise<ArrayLike<number>>((resolve) =>
          pendingRef.current.set(requestId, resolve)
        );
        const common = {
          requestId,
          direction: request.direction,
          focusIndex: engine.selectionFocusIndex,
          visibleIndices: visible ?? null,
        };
        if (request.columnKey === SOURCE_INDEX_COLUMN) {
          worker.postMessage(
            {type: 'sort-index', rowCount, ...common},
            transfer
          );
          return result;
        }
        const numeric = numericSortSource(
          request.columnKey,
          mapping,
          engine,
          rowCount
        );
        if (numeric) {
          transfer.push(numeric.values.buffer);
          worker.postMessage(
            {
              type: 'sort-number',
              values: numeric.values,
              invert: numeric.invert,
              ...common,
            },
            transfer
          );
          return result;
        }
        const custom = customColumns.get(String(request.columnKey));
        if (!custom) return [];
        if (custom.kind === 'number') {
          const values = custom.values.slice() as Float64Array<ArrayBuffer>;
          transfer.push(values.buffer);
          worker.postMessage(
            {type: 'sort-number', values, invert: false, ...common},
            transfer
          );
        } else {
          const codes = custom.codes.slice() as Uint32Array<ArrayBuffer>;
          transfer.push(codes.buffer);
          worker.postMessage(
            {
              type: 'sort-category',
              codes,
              dictionary: custom.dictionary,
              ...common,
            },
            transfer
          );
        }
        return result;
      },
    }),
    [customColumns, engine, mapping, rowCount, visibleIndices]
  );

  return {columns, rowSource};
}
