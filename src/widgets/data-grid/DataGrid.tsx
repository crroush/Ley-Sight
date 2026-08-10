import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';
import {ArrowDown, ArrowUp, ChevronsUpDown} from 'lucide-react';

export type DataGridSortDirection = 'ascending' | 'descending';

export interface DataGridSortRequest {
  columnKey: string | number;
  direction: DataGridSortDirection;
}

export interface DataGridColumn<RowId> {
  key: string | number;
  label: ReactNode;
  width?: number;
  renderCell: (rowId: RowId, position: number) => ReactNode;
  sortValue?: (rowId: RowId, position: number) => string | number;
  /** Change when this column's sorting semantics change without changing its key. */
  sortRevision?: unknown;
}

/** A positional adapter lets the grid virtualize data without materializing rows. */
export interface DataGridRowSource<RowId> {
  rowCount: number;
  rowIdAt: (position: number) => RowId;
  /** Optional fast reverse lookup used to reveal map-driven selections. */
  positionOf?: (rowId: RowId) => number;
  /** Change when the positional contents change without changing rowCount. */
  revision?: unknown;
  /** Optional capability. Large/packed sources can delegate this to a worker. */
  sort?: (request: DataGridSortRequest) => Promise<ArrayLike<RowId>>;
  /** Optionally re-filter an existing adapter sort after a same-size revision. */
  refreshSort?: (request: DataGridSortRequest) => Promise<ArrayLike<RowId>>;
}

export interface DataGridSelectionModel<RowId> {
  isSelected: (rowId: RowId) => boolean;
  onSelection: (rowIds: readonly RowId[], additive: boolean) => void;
  /** Handles large ranges without forcing DataGrid to allocate a dense array. */
  onRangeSelection?: (rowIds: Iterable<RowId>, additive: boolean) => void;
  focusRowId?: RowId;
  revision?: number;
}

export interface DataGridProps<RowId> {
  columns: readonly DataGridColumn<RowId>[];
  rowSource: DataGridRowSource<RowId>;
  selection: DataGridSelectionModel<RowId>;
  className?: string;
  headerClassName?: string;
  headerScrollClassName?: string;
  rowClassName?: string;
  scrollClassName?: string;
  spacerClassName?: string;
  gridTemplateColumns?: string;
  estimateSize?: number;
  overscan?: number;
  pageSize?: number;
  page?: number;
  onPageChange?: (page: number) => void;
  emptyContent?: ReactNode;
  onSortingChange?: (sorting: boolean) => void;
  initialSort?: DataGridSortRequest;
  rowKey?: (rowId: RowId, position: number) => string | number;
  onRowContextMenu?: (x: number, y: number, rowId: RowId) => void;
}

export function DataGrid<RowId>({
  columns,
  rowSource,
  selection,
  className = 'reference-table-frame',
  headerClassName = 'reference-table-header',
  headerScrollClassName,
  rowClassName = 'reference-table-row',
  scrollClassName = 'reference-table-scroll',
  spacerClassName = 'reference-table-spacer',
  gridTemplateColumns,
  estimateSize = 27,
  overscan = 14,
  pageSize = Number.POSITIVE_INFINITY,
  page = 0,
  onPageChange,
  emptyContent,
  onSortingChange,
  initialSort,
  rowKey = (rowId) => String(rowId),
  onRowContextMenu,
}: DataGridProps<RowId>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  const pendingFocusPositionRef = useRef(-1);
  const sortRevisionRef = useRef(0);
  const [sort, setSort] = useState<DataGridSortRequest | null>(null);
  const [sortedRows, setSortedRows] = useState<ArrayLike<RowId> | null>(null);
  const effectiveSortedRows =
    sortedRows?.length === rowSource.rowCount ? sortedRows : null;
  const count = effectiveSortedRows?.length ?? rowSource.rowCount;
  const pageStart = Number.isFinite(pageSize) ? page * pageSize : 0;
  const pageLength = Math.min(pageSize, Math.max(0, count - pageStart));
  const width = columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
  const explicitWidth = columns.every((column) => column.width != null);
  const rowIdAt = (position: number): RowId =>
    effectiveSortedRows?.[position] ?? rowSource.rowIdAt(position);
  const virtualizer = useVirtualizer({
    count: pageLength,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({top: 0});
  }, [page]);

  useEffect(() => {
    anchorRef.current = null;
    scrollRef.current?.scrollTo({top: 0});
  }, [rowSource.revision, rowSource.rowCount]);

  useEffect(() => {
    if (selection.focusRowId == null) return;
    let position =
      effectiveSortedRows == null
        ? (rowSource.positionOf?.(selection.focusRowId) ?? -1)
        : -1;
    if (
      position < 0 &&
      (effectiveSortedRows != null || !rowSource.positionOf)
    ) {
      for (let index = 0; index < count; index += 1) {
        if (Object.is(rowIdAt(index), selection.focusRowId)) {
          position = index;
          break;
        }
      }
    }
    if (position < 0) return;
    const focusPage = Number.isFinite(pageSize)
      ? Math.floor(position / pageSize)
      : 0;
    if (focusPage !== page) {
      pendingFocusPositionRef.current = position;
      onPageChange?.(focusPage);
    } else {
      pendingFocusPositionRef.current = -1;
      virtualizer.scrollToIndex(position - pageStart, {align: 'auto'});
    }
  }, [
    rowSource.revision,
    rowSource.rowCount,
    selection.focusRowId,
    selection.revision,
    sortedRows,
  ]);

  useEffect(() => {
    const position = pendingFocusPositionRef.current;
    if (position < 0) return;
    const focusPage = Number.isFinite(pageSize)
      ? Math.floor(position / pageSize)
      : 0;
    if (focusPage !== page) return;
    pendingFocusPositionRef.current = -1;
    virtualizer.scrollToIndex(position - pageStart, {align: 'auto'});
  }, [page, pageStart, pageSize, sortedRows, virtualizer]);

  const applySort = async (
    column: DataGridColumn<RowId>,
    request: DataGridSortRequest,
    refresh = false
  ): Promise<void> => {
    const revision = ++sortRevisionRef.current;
    activeColumnRef.current = {
      key: column.key,
      sortRevision: column.sortRevision,
    };
    anchorRef.current = null;
    setSort(request);
    onSortingChange?.(true);
    try {
      const rows =
        refresh && rowSource.refreshSort
          ? await rowSource.refreshSort(request)
          : rowSource.sort
            ? await rowSource.sort(request)
            : Array.from(
                {length: rowSource.rowCount},
                (_, position) => position
              )
                .sort((first, second) => {
                  const firstRowId = rowSource.rowIdAt(first);
                  const secondRowId = rowSource.rowIdAt(second);
                  const firstValue = column.sortValue!(firstRowId, first);
                  const secondValue = column.sortValue!(secondRowId, second);
                  const difference =
                    typeof firstValue === 'number' &&
                    typeof secondValue === 'number'
                      ? firstValue - secondValue
                      : String(firstValue).localeCompare(
                          String(secondValue),
                          undefined,
                          {
                            numeric: true,
                          }
                        );
                  return request.direction === 'descending'
                    ? -difference
                    : difference;
                })
                .map((position) => rowSource.rowIdAt(position));
      if (revision === sortRevisionRef.current) {
        setSortedRows(rows);
        if (!refresh) onPageChange?.(0);
      }
    } finally {
      if (revision === sortRevisionRef.current) onSortingChange?.(false);
    }
  };

  const sourceStateRef = useRef({
    revision: rowSource.revision,
    rowCount: rowSource.rowCount,
  });
  const activeColumnRef = useRef<
    {key: string | number; sortRevision: unknown} | undefined
  >(undefined);
  useEffect(() => {
    const previous = sourceStateRef.current;
    const sourceChanged =
      !Object.is(previous.revision, rowSource.revision) ||
      previous.rowCount !== rowSource.rowCount;
    const column = sort
      ? columns.find((candidate) => candidate.key === sort.columnKey)
      : undefined;
    const activeColumn = activeColumnRef.current;
    const columnChanged =
      activeColumn != null &&
      (column == null ||
        column.key !== activeColumn.key ||
        !Object.is(column.sortRevision, activeColumn.sortRevision));
    if (!sourceChanged && !columnChanged) return;
    if (sourceChanged) {
      sourceStateRef.current = {
        revision: rowSource.revision,
        rowCount: rowSource.rowCount,
      };
    }
    sortRevisionRef.current += 1;
    setSortedRows(null);
    if (!sort) {
      onSortingChange?.(false);
      return;
    }
    if (!column || (!column.sortValue && !rowSource.sort)) {
      setSort(null);
      onSortingChange?.(false);
      return;
    }
    void applySort(
      column,
      sort,
      sourceChanged &&
        !columnChanged &&
        previous.rowCount === rowSource.rowCount
    );
  }, [columns, rowSource.revision, rowSource.rowCount]);

  const requestSort = (column: DataGridColumn<RowId>): void => {
    if (!column.sortValue && !rowSource.sort) return;
    void applySort(column, {
      columnKey: column.key,
      direction:
        sort?.columnKey === column.key && sort.direction === 'ascending'
          ? 'descending'
          : 'ascending',
    });
  };

  const initialSortAppliedRef = useRef(false);
  useEffect(() => {
    if (initialSortAppliedRef.current || !initialSort) return;
    initialSortAppliedRef.current = true;
    const column = columns.find(
      (candidate) => candidate.key === initialSort.columnKey
    );
    if (column && (column.sortValue || rowSource.sort)) {
      void applySort(column, initialSort);
    }
  }, [columns, initialSort, rowSource]);

  const header = (
    <div
      className={headerClassName}
      style={{
        ...(gridTemplateColumns ? {gridTemplateColumns} : {}),
        ...(explicitWidth ? {width} : {}),
      }}
    >
      {columns.map((column) => {
        const active = sort?.columnKey === column.key;
        return (
          <button
            type="button"
            key={String(column.key)}
            className={active ? 'is-sorted' : ''}
            style={column.width == null ? undefined : {width: column.width}}
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
  );

  return (
    <section className={className} data-selection-revision={selection.revision}>
      {headerScrollClassName ? (
        <div className={headerScrollClassName} ref={headerScrollRef}>
          {header}
        </div>
      ) : (
        header
      )}
      <div
        className={scrollClassName}
        ref={scrollRef}
        onScroll={(event) => {
          if (headerScrollRef.current)
            headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        {!count ? (
          emptyContent
        ) : (
          <div
            className={spacerClassName}
            style={{
              height: virtualizer.getTotalSize(),
              ...(explicitWidth ? {width} : {}),
            }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const position = pageStart + item.index;
              const rowId = rowIdAt(position);
              return (
                <button
                  type="button"
                  key={rowKey(rowId, position)}
                  className={`${rowClassName} ${selection.isSelected(rowId) ? 'is-selected' : ''}`.trim()}
                  style={{
                    transform: `translateY(${item.start}px)`,
                    ...(gridTemplateColumns ? {gridTemplateColumns} : {}),
                    ...(explicitWidth ? {width} : {}),
                  }}
                  onContextMenu={(event) => {
                    if (!onRowContextMenu) return;
                    event.preventDefault();
                    onRowContextMenu(event.clientX, event.clientY, rowId);
                  }}
                  onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                    const additive = event.ctrlKey || event.metaKey;
                    if (event.shiftKey && anchorRef.current != null) {
                      const first = Math.min(anchorRef.current, position);
                      const last = Math.max(anchorRef.current, position);
                      const rows = function* (): IterableIterator<RowId> {
                        for (let index = first; index <= last; index += 1)
                          yield rowIdAt(index);
                      };
                      if (selection.onRangeSelection)
                        selection.onRangeSelection(rows(), additive);
                      else selection.onSelection(Array.from(rows()), additive);
                      return;
                    }
                    anchorRef.current = position;
                    selection.onSelection([rowId], additive);
                  }}
                >
                  {columns.map((column) => (
                    <span
                      key={String(column.key)}
                      style={
                        column.width == null ? undefined : {width: column.width}
                      }
                    >
                      {column.renderCell(rowId, position)}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
