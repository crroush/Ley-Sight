import {useEffect, useMemo, useRef, useState} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  PanelBottomClose,
} from 'lucide-react';
import type {
  CsvColumnMapping,
  PackedTableColumn,
  PackedTableData,
  TableRow,
} from '../lib/types';
import {tableSelectionRange} from '../lib/tableSelection';
import type {FastPointEngine} from '../map/FastPointEngine';

type SortDirection = 'ascending' | 'descending';

type SortState = {
  column: string;
  direction: SortDirection;
};

type VirtualDataTableProps = {
  panelId?: string;
  labelledBy?: string;
  engine: FastPointEngine | null;
  rowCount: number;
  columns: string[];
  mapping?: CsvColumnMapping;
  tableData: PackedTableData | null;
  visibleIndices: Uint32Array | null;
  selectionRevision: number;
  onSelectRow: (index: number, toggle: boolean) => void;
  onCollapse: () => void;
};

type DisplayColumn = {
  key: string;
  label: string;
  width: number;
  source?: string;
};

type TableSortResult = {
  type: 'result';
  requestId: number;
  indices: Uint32Array<ArrayBuffer>;
  focusPosition: number;
};

const TABLE_PAGE_SIZE = 100_000;
const SOURCE_INDEX_COLUMN = '__source_index__';

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
  ) {
    return 132;
  }
  return Math.max(120, Math.min(260, 82 + column.length * 7));
}

function semanticValue(
  column: string,
  mapping: CsvColumnMapping | undefined,
  row: TableRow
): string | undefined {
  if (column === mapping?.latitude) return formatNumber(row.latitude, 7);
  if (column === mapping?.longitude) return formatNumber(row.longitude, 7);
  if (column === mapping?.time) {
    return Number.isFinite(row.time)
      ? new Date(row.time * 1000).toISOString()
      : '—';
  }
  if (column === mapping?.semiMajor) return formatNumber(row.semiMajor, 3);
  if (column === mapping?.semiMinor) return formatNumber(row.semiMinor, 3);
  if (column === mapping?.tilt) return formatNumber(row.tilt, 3);
  return undefined;
}

function customValue(
  column: PackedTableColumn | undefined,
  index: number
): string {
  if (!column) return '—';
  if (column.kind === 'number') return formatNumber(column.values[index], 8);
  return column.dictionary[column.codes[index]] ?? '';
}

function numericSortSource(
  column: string,
  mapping: CsvColumnMapping | undefined,
  engine: FastPointEngine,
  rowCount: number
): {
  values: Float64Array<ArrayBuffer> | Float32Array<ArrayBuffer>;
  invert: boolean;
} | null {
  const snapshot = engine.snapshot;
  if (column === mapping?.latitude) {
    return {
      values: snapshot.y.slice(0, rowCount) as Float64Array<ArrayBuffer>,
      invert: false,
    };
  }
  if (column === mapping?.longitude) {
    return {
      values: snapshot.x.slice(0, rowCount) as Float64Array<ArrayBuffer>,
      invert: false,
    };
  }
  if (column === mapping?.time) {
    return {
      values: snapshot.time.slice(0, rowCount) as Float64Array<ArrayBuffer>,
      invert: false,
    };
  }
  if (column === mapping?.semiMajor) {
    return {
      values: snapshot.sma.slice(0, rowCount) as Float32Array<ArrayBuffer>,
      invert: false,
    };
  }
  if (column === mapping?.semiMinor) {
    return {
      values: snapshot.smi.slice(0, rowCount) as Float32Array<ArrayBuffer>,
      invert: false,
    };
  }
  if (column === mapping?.tilt) {
    // Engine rotation is 90° - CSV tilt, so its ordering is reversed.
    return {
      values: snapshot.tilt.slice(0, rowCount) as Float32Array<ArrayBuffer>,
      invert: true,
    };
  }
  return null;
}

export function VirtualDataTable({
  panelId,
  labelledBy,
  engine,
  rowCount,
  columns,
  mapping,
  tableData,
  visibleIndices,
  selectionRevision,
  onSelectRow,
  onCollapse,
}: VirtualDataTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const sortWorkerRef = useRef<Worker | null>(null);
  const sortRequestIdRef = useRef(0);
  const pendingFocusPositionRef = useRef(-1);
  const [sort, setSort] = useState<SortState | null>(null);
  const [sortedIndices, setSortedIndices] =
    useState<Uint32Array<ArrayBuffer> | null>(null);
  const [sorting, setSorting] = useState(false);
  const [page, setPage] = useState(0);

  const displayColumns = useMemo<DisplayColumn[]>(
    () => [
      {
        key: SOURCE_INDEX_COLUMN,
        label: 'Source row',
        width: 96,
      },
      ...columns.map((column) => ({
        key: column,
        label: column,
        source: column,
        width: displayWidth(column, mapping),
      })),
    ],
    [columns, mapping]
  );
  const customColumns = useMemo(
    () =>
      new Map(
        (tableData?.columns ?? []).map((column) => [column.name, column])
      ),
    [tableData]
  );
  const effectiveIndices = sort
    ? (sortedIndices ?? visibleIndices)
    : visibleIndices;
  const count = effectiveIndices?.length ?? rowCount;
  const pageCount = Math.max(1, Math.ceil(count / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * TABLE_PAGE_SIZE;
  const pageLength = Math.min(TABLE_PAGE_SIZE, Math.max(0, count - pageStart));
  const gridWidth = displayColumns.reduce(
    (total, column) => total + column.width,
    0
  );
  const virtualizer = useVirtualizer({
    count: pageLength,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 31,
    overscan: 14,
  });

  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/tableSort.worker.ts', import.meta.url),
      {type: 'module'}
    );
    sortWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<TableSortResult>) => {
      if (
        event.data.type !== 'result' ||
        event.data.requestId !== sortRequestIdRef.current
      ) {
        return;
      }
      pendingFocusPositionRef.current = event.data.focusPosition;
      setSortedIndices(event.data.indices);
      if (event.data.focusPosition >= 0) {
        setPage(Math.floor(event.data.focusPosition / TABLE_PAGE_SIZE));
      }
      setSorting(false);
    };
    return () => {
      worker.terminate();
      sortWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    setPage(0);
    selectionAnchorRef.current = null;
    parentRef.current?.scrollTo({top: 0});
  }, [rowCount, visibleIndices]);

  useEffect(() => {
    // Appending rows invalidates the index array produced by the previous sort.
    setSort(null);
    setSortedIndices(null);
    setSorting(false);
    sortRequestIdRef.current += 1;
  }, [rowCount]);

  useEffect(() => {
    // A Shift-range anchor is a presentation position, unlike selection
    // membership. Sorting invalidates the anchor but not selected source rows.
    selectionAnchorRef.current = null;
  }, [sortedIndices]);

  useEffect(() => {
    const focusIndex = engine?.selectionFocusIndex ?? -1;
    if (focusIndex < 0) return;
    const focusPosition = effectiveIndices
      ? effectiveIndices.indexOf(focusIndex)
      : focusIndex;
    if (focusPosition < 0) return;
    pendingFocusPositionRef.current = focusPosition;
    setPage(Math.floor(focusPosition / TABLE_PAGE_SIZE));
  }, [effectiveIndices, engine, selectionRevision]);

  useEffect(() => {
    const focusPosition = pendingFocusPositionRef.current;
    if (focusPosition < 0) return;
    const focusPage = Math.floor(focusPosition / TABLE_PAGE_SIZE);
    if (focusPage !== currentPage) return;
    pendingFocusPositionRef.current = -1;
    window.requestAnimationFrame(() => {
      parentRef.current?.scrollTo({
        top: (focusPosition - focusPage * TABLE_PAGE_SIZE) * 31,
      });
    });
  }, [currentPage, sortedIndices]);

  useEffect(() => {
    if (!sort || !sortWorkerRef.current) return;
    const requestId = ++sortRequestIdRef.current;
    const visible = visibleIndices
      ? (visibleIndices.slice() as Uint32Array<ArrayBuffer>)
      : null;
    setSorting(true);
    sortWorkerRef.current.postMessage(
      {
        type: 'filter',
        requestId,
        focusIndex: engine?.selectionFocusIndex ?? -1,
        visibleIndices: visible,
      },
      visible ? [visible.buffer] : []
    );
  }, [engine, visibleIndices]);

  const changePage = (nextPage: number): void => {
    setPage(Math.max(0, Math.min(pageCount - 1, nextPage)));
    parentRef.current?.scrollTo({top: 0});
  };

  const requestSort = (column: DisplayColumn): void => {
    const worker = sortWorkerRef.current;
    if (!worker || !engine || !rowCount) return;
    const direction: SortDirection =
      sort?.column === column.key && sort.direction === 'ascending'
        ? 'descending'
        : 'ascending';
    const requestId = ++sortRequestIdRef.current;
    const visible = visibleIndices
      ? (visibleIndices.slice() as Uint32Array<ArrayBuffer>)
      : null;
    const transfer: Transferable[] = visible ? [visible.buffer] : [];
    setSort({column: column.key, direction});
    setSorting(true);

    if (column.key === SOURCE_INDEX_COLUMN) {
      worker.postMessage(
        {
          type: 'sort-index',
          requestId,
          rowCount,
          direction,
          focusIndex: engine.selectionFocusIndex,
          visibleIndices: visible,
        },
        transfer
      );
      return;
    }

    const numeric = numericSortSource(column.key, mapping, engine, rowCount);
    if (numeric) {
      transfer.push(numeric.values.buffer);
      worker.postMessage(
        {
          type: 'sort-number',
          requestId,
          values: numeric.values,
          direction,
          invert: numeric.invert,
          focusIndex: engine.selectionFocusIndex,
          visibleIndices: visible,
        },
        transfer
      );
      return;
    }

    const custom = customColumns.get(column.key);
    if (!custom) {
      setSorting(false);
      return;
    }
    if (custom.kind === 'number') {
      const values = custom.values.slice() as Float64Array<ArrayBuffer>;
      transfer.push(values.buffer);
      worker.postMessage(
        {
          type: 'sort-number',
          requestId,
          values,
          direction,
          invert: false,
          visibleIndices: visible,
        },
        transfer
      );
      return;
    }
    const codes = custom.codes.slice() as Uint32Array<ArrayBuffer>;
    transfer.push(codes.buffer);
    worker.postMessage(
      {
        type: 'sort-category',
        requestId,
        codes,
        dictionary: custom.dictionary,
        direction,
        focusIndex: engine.selectionFocusIndex,
        visibleIndices: visible,
      },
      transfer
    );
  };

  return (
    <section
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      className="table-panel"
      data-selection-revision={selectionRevision}
    >
      <div className="panel-heading table-title">
        <div>
          <span className="eyebrow">FEATURE TABLE</span>
          <strong>
            {count.toLocaleString()} visible
            <span className="muted">
              {' · '}
              {(engine?.selectionCount ?? 0).toLocaleString()} selected
              {sorting ? ' · sorting…' : ''}
            </span>
          </strong>
        </div>
        <div className="table-page-controls">
          <span className="table-hint">
            {count
              ? `Rows ${(pageStart + 1).toLocaleString()}–${(
                  pageStart + pageLength
                ).toLocaleString()}`
              : 'No rows'}
          </span>
          <span className="table-hint selection-hint">
            Shift: range · Ctrl/Cmd: toggle
          </span>
          <button
            className="text-button"
            disabled={currentPage === 0}
            onClick={() => changePage(currentPage - 1)}
          >
            Previous
          </button>
          <button
            className="text-button"
            disabled={currentPage >= pageCount - 1}
            onClick={() => changePage(currentPage + 1)}
          >
            Next
          </button>
          <button
            className="panel-drawer-button"
            type="button"
            aria-label="Collapse feature table"
            title="Collapse feature table"
            onClick={onCollapse}
          >
            <PanelBottomClose size={16} />
          </button>
        </div>
      </div>
      <div className="data-grid-header-scroll" ref={headerScrollRef}>
        <div className="data-grid-header" style={{width: gridWidth}}>
          {displayColumns.map((column) => {
            const active = sort?.column === column.key;
            return (
              <button
                key={column.key}
                type="button"
                className={active ? 'is-sorted' : ''}
                style={{width: column.width}}
                aria-sort={active ? sort.direction : 'none'}
                onClick={() => requestSort(column)}
              >
                <span>{column.label}</span>
                {active && sort.direction === 'ascending' ? (
                  <ArrowUp size={12} />
                ) : active ? (
                  <ArrowDown size={12} />
                ) : (
                  <ChevronsUpDown size={12} />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div
        className="data-grid-scroll"
        ref={parentRef}
        onScroll={(event) => {
          if (headerScrollRef.current) {
            headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
      >
        {!engine || count === 0 ? (
          <div className="empty-table">Load a CSV dataset to inspect rows.</div>
        ) : (
          <div
            className="data-grid-spacer"
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: gridWidth,
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const rowPosition = pageStart + virtualRow.index;
              const sourceIndex = effectiveIndices
                ? effectiveIndices[rowPosition]
                : rowPosition;
              const row = engine.row(sourceIndex);
              const isSelected = engine.isSelected(sourceIndex);
              return (
                <button
                  type="button"
                  key={sourceIndex}
                  className={`data-grid-row ${isSelected ? 'is-selected' : ''}`}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    width: gridWidth,
                  }}
                  onClick={(event) => {
                    const toggle = event.ctrlKey || event.metaKey;
                    if (event.shiftKey && selectionAnchorRef.current != null) {
                      engine.selectIndices(
                        tableSelectionRange(
                          selectionAnchorRef.current,
                          rowPosition,
                          rowCount,
                          effectiveIndices
                        ),
                        !toggle
                      );
                      return;
                    }
                    selectionAnchorRef.current = rowPosition;
                    onSelectRow(sourceIndex, toggle);
                  }}
                >
                  {displayColumns.map((column) => {
                    const value =
                      column.key === SOURCE_INDEX_COLUMN
                        ? sourceIndex.toLocaleString()
                        : (semanticValue(column.key, mapping, row) ??
                          customValue(
                            customColumns.get(column.key),
                            sourceIndex
                          ));
                    return (
                      <span key={column.key} style={{width: column.width}}>
                        {value}
                      </span>
                    );
                  })}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
