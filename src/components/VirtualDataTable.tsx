import {useState} from 'react';
import {PanelBottomClose} from 'lucide-react';
import type {CsvColumnMapping, PackedTableData} from '../lib/types';
import type {FastPointEngine} from '../map/FastPointEngine';
import {DataGrid} from '../widgets/data-grid/DataGrid';
import {usePackedCsvAdapter} from '../widgets/data-grid/adapters/packedCsvAdapter';

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

const TABLE_PAGE_SIZE = 100_000;

/** CSV workspace compatibility wrapper around the storage-agnostic DataGrid. */
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
  const [page, setPage] = useState(0);
  const [sorting, setSorting] = useState(false);
  const adapter = usePackedCsvAdapter({
    engine,
    rowCount,
    columnNames: columns,
    mapping,
    tableData,
    visibleIndices,
  });
  const count = adapter.rowSource.rowCount;
  const pageCount = Math.max(1, Math.ceil(count / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * TABLE_PAGE_SIZE;
  const pageLength = Math.min(TABLE_PAGE_SIZE, Math.max(0, count - pageStart));

  return (
    <section
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      className="table-panel"
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
            onClick={() => setPage(Math.max(0, currentPage - 1))}
          >
            Previous
          </button>
          <button
            className="text-button"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
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
      <DataGrid
        columns={adapter.columns}
        rowSource={adapter.rowSource}
        selection={{
          isSelected: (index) => engine?.isSelected(index) ?? false,
          onSelection: (indices, additive) => {
            if (indices.length === 1) onSelectRow(indices[0], additive);
            else engine?.selectIndices(Uint32Array.from(indices), !additive);
          },
          onRangeSelection: (indices, additive) =>
            engine?.selectIndices(Uint32Array.from(indices), !additive),
          focusRowId:
            (engine?.selectionFocusIndex ?? -1) >= 0
              ? engine?.selectionFocusIndex
              : undefined,
          revision: selectionRevision,
        }}
        className="data-grid-contents"
        headerClassName="data-grid-header"
        headerScrollClassName="data-grid-header-scroll"
        rowClassName="data-grid-row"
        scrollClassName="data-grid-scroll"
        spacerClassName="data-grid-spacer"
        estimateSize={31}
        pageSize={TABLE_PAGE_SIZE}
        page={currentPage}
        onPageChange={setPage}
        onSortingChange={setSorting}
        emptyContent={
          <div className="empty-table">Load a CSV dataset to inspect rows.</div>
        }
      />
    </section>
  );
}
