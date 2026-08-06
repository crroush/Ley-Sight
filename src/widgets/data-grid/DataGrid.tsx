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
}

export interface DataGridSelectionModel<RowId> {
  isSelected: (rowId: RowId) => boolean;
  onSelection: (rowIds: readonly RowId[], additive: boolean) => void;
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
  rowKey = (rowId) => String(rowId),
  onRowContextMenu,
}: DataGridProps<RowId>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
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
    anchorRef.current = null;
    scrollRef.current?.scrollTo({top: 0});
  }, [rowSource.revision, page]);

  useEffect(() => {
    sortRevisionRef.current += 1;
    setSort(null);
    setSortedRows(null);
    onSortingChange?.(false);
  }, [rowSource.revision]);

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
    if (focusPage !== page) onPageChange?.(focusPage);
    else virtualizer.scrollToIndex(position - pageStart, {align: 'auto'});
  }, [
    rowSource.revision,
    selection.focusRowId,
    selection.revision,
    sortedRows,
  ]);

  const requestSort = async (column: DataGridColumn<RowId>): Promise<void> => {
    if (!column.sortValue && !rowSource.sort) return;
    const request: DataGridSortRequest = {
      columnKey: column.key,
      direction:
        sort?.columnKey === column.key && sort.direction === 'ascending'
          ? 'descending'
          : 'ascending',
    };
    const revision = ++sortRevisionRef.current;
    setSort(request);
    onSortingChange?.(true);
    try {
      const rows = rowSource.sort
        ? await rowSource.sort(request)
        : Array.from({length: rowSource.rowCount}, (_, position) => position)
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
        onPageChange?.(0);
      }
    } finally {
      if (revision === sortRevisionRef.current) onSortingChange?.(false);
    }
  };

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
            onClick={() => void requestSort(column)}
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
                      selection.onSelection(
                        Array.from({length: last - first + 1}, (_, offset) =>
                          rowIdAt(first + offset)
                        ),
                        additive
                      );
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
