import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

export type VirtualDataTableColumn<Row> = {
  key: string | number
  heading: string
  sortValue: (row: Row, index: number) => string | number
  render: (row: Row, index: number) => ReactNode
}

export type VirtualDataTableProps<Row, Key extends string | number> = {
  rows: readonly Row[]
  columns: readonly VirtualDataTableColumn<Row>[]
  rowKey: (row: Row, index: number) => string | number
  selected: ReadonlySet<Key>
  selectionKey: (row: Row, index: number) => Key
  onSelection: (keys: readonly Key[], additive: boolean) => void
  className?: string
  headerClassName?: string
  rowClassName?: string
  scrollClassName?: string
  spacerClassName?: string
  gridTemplateColumns?: string
  estimateSize?: number
  initialSort?: { column: number; descending: boolean }
  onRowContextMenu?: (x: number, y: number, row: Row, index: number) => void
}

export function VirtualDataTable<Row, Key extends string | number>({
  rows,
  columns,
  rowKey,
  selected,
  selectionKey,
  onSelection,
  className = 'reference-table-frame',
  headerClassName = 'reference-table-header',
  rowClassName = 'reference-table-row',
  scrollClassName = 'reference-table-scroll',
  spacerClassName = 'reference-table-spacer',
  gridTemplateColumns,
  estimateSize = 27,
  initialSort,
  onRowContextMenu,
}: VirtualDataTableProps<Row, Key>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<number | null>(null)
  const [sort, setSort] = useState<{
    column: number
    descending: boolean
  } | null>(initialSort ?? null)
  const displayRows = useMemo(() => {
    const output = rows.map((_, index) => index)
    if (!sort) return output
    const column = columns[sort.column]
    output.sort((first, second) => {
      const firstValue = column.sortValue(rows[first], first)
      const secondValue = column.sortValue(rows[second], second)
      const difference =
        typeof firstValue === 'number'
          ? firstValue - (secondValue as number)
          : firstValue.localeCompare(secondValue as string, undefined, {
              numeric: true,
            })
      return sort.descending ? -difference : difference
    })
    return output
  }, [columns, rows, sort])
  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan: 14,
  })
  const firstSelected = selected.values().next().value as Key | undefined
  useEffect(() => {
    if (firstSelected == null) return
    const visiblePosition = displayRows.findIndex(
      (index) => selectionKey(rows[index], index) === firstSelected
    )
    if (visiblePosition >= 0)
      virtualizer.scrollToIndex(visiblePosition, { align: 'auto' })
  }, [displayRows, firstSelected, rows, selectionKey, virtualizer])
  return (
    <section className={className}>
      <div
        className={headerClassName}
        style={gridTemplateColumns ? { gridTemplateColumns } : undefined}
      >
        {columns.map((column, index) => (
          <button
            type="button"
            key={String(column.key)}
            onClick={() =>
              setSort((current) => ({
                column: index,
                descending:
                  current?.column === index ? !current.descending : false,
              }))
            }
          >
            {column.heading}
            {sort?.column === index ? (sort.descending ? ' ▼' : ' ▲') : ''}
          </button>
        ))}
      </div>
      <div className={scrollClassName} ref={scrollRef}>
        <div
          className={spacerClassName}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const index = displayRows[item.index]
            const row = rows[index]
            const key = selectionKey(row, index)
            return (
              <button
                type="button"
                className={`${rowClassName} ${selected.has(key) ? 'is-selected' : ''}`}
                key={rowKey(row, index)}
                style={{
                  transform: `translateY(${item.start}px)`,
                  ...(gridTemplateColumns ? { gridTemplateColumns } : {}),
                }}
                onContextMenu={(event) => {
                  if (onRowContextMenu) {
                    event.preventDefault()
                    onRowContextMenu(event.clientX, event.clientY, row, index)
                  }
                }}
                onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                  const additive = event.ctrlKey || event.metaKey
                  if (event.shiftKey && anchorRef.current != null) {
                    const first = Math.min(anchorRef.current, item.index)
                    const last = Math.max(anchorRef.current, item.index)
                    onSelection(
                      displayRows
                        .slice(first, last + 1)
                        .map((rowIndex) =>
                          selectionKey(rows[rowIndex], rowIndex)
                        ),
                      additive
                    )
                    return
                  }
                  anchorRef.current = item.index
                  onSelection([key], additive)
                }}
              >
                {columns.map((column) => (
                  <span key={String(column.key)}>
                    {column.render(row, index)}
                  </span>
                ))}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
