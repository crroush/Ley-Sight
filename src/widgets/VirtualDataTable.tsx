import {useMemo, useRef, type ReactNode} from 'react';
import {
  DataGrid,
  type DataGridColumn,
  type DataGridProps,
} from './data-grid/DataGrid';

export type VirtualDataTableColumn<Row> = {
  key: string | number;
  heading: string;
  sortValue: (row: Row, index: number) => string | number;
  render: (row: Row, index: number) => ReactNode;
};

export type VirtualDataTableProps<Row, Key extends string | number> = {
  rows: readonly Row[];
  columns: readonly VirtualDataTableColumn<Row>[];
  rowKey: (row: Row, index: number) => string | number;
  selected: ReadonlySet<Key>;
  selectionKey: (row: Row, index: number) => Key;
  onSelection: (keys: readonly Key[], additive: boolean) => void;
  className?: string;
  headerClassName?: string;
  rowClassName?: string;
  scrollClassName?: string;
  spacerClassName?: string;
  gridTemplateColumns?: string;
  estimateSize?: number;
  initialSort?: {column: number; descending: boolean};
  onRowContextMenu?: (x: number, y: number, row: Row, index: number) => void;
};

/** @deprecated Prefer DataGrid with a DataGridRowSource. */
export function VirtualDataTable<Row, Key extends string | number>({
  rows,
  columns,
  rowKey,
  selected,
  selectionKey,
  onSelection,
  initialSort,
  onRowContextMenu,
  ...presentation
}: VirtualDataTableProps<Row, Key>) {
  const gridColumns = useMemo<readonly DataGridColumn<number>[]>(
    () =>
      columns.map((column) => ({
        key: column.key,
        label: column.heading,
        sortValue: (index) => column.sortValue(rows[index], index),
        renderCell: (index) => column.render(rows[index], index),
      })),
    [columns, rows]
  );
  const initialColumn = initialSort ? columns[initialSort.column] : undefined;
  const firstSelected = selected.values().next().value as Key | undefined;
  const focusedPosition =
    firstSelected == null
      ? -1
      : rows.findIndex(
          (row, index) => selectionKey(row, index) === firstSelected
        );
  const selectionRevisionRef = useRef({selected, revision: 0});
  if (!Object.is(selectionRevisionRef.current.selected, selected)) {
    selectionRevisionRef.current = {
      selected,
      revision: selectionRevisionRef.current.revision + 1,
    };
  }
  const props: DataGridProps<number> = {
    ...presentation,
    columns: gridColumns,
    rowSource: {
      rowCount: rows.length,
      rowIdAt: (index) => index,
      revision: rows,
    },
    selection: {
      isSelected: (index) => selected.has(selectionKey(rows[index], index)),
      onSelection: (indices, additive) =>
        onSelection(
          indices.map((index) => selectionKey(rows[index], index)),
          additive
        ),
      focusRowId: focusedPosition >= 0 ? focusedPosition : undefined,
      // Preserve the legacy wrapper's reveal behavior even when an external
      // selection update retains the same first selected row.
      revision: selectionRevisionRef.current.revision,
    },
    onRowContextMenu: onRowContextMenu
      ? (x, y, index) => onRowContextMenu(x, y, rows[index], index)
      : undefined,
    rowKey: (index) => rowKey(rows[index], index),
    initialSort:
      initialSort && initialColumn
        ? {
            columnKey: initialColumn.key,
            direction: initialSort.descending ? 'descending' : 'ascending',
          }
        : undefined,
  };
  return <DataGrid {...props} />;
}
