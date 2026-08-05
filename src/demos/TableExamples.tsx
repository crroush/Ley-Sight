import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { containsCoordinate } from 'ol/extent.js'
import { fromLonLat } from 'ol/proj.js'
import { HistogramRange } from '../components/HistogramRange'
import {
  buildFineTimeHistogram,
  formatFullTimestamp,
} from '../lib/timeHistogram'
import { FastPointEngine } from '../map/FastPointEngine'
import {
  createReferenceDataset,
  createReferenceRandom,
  packRgba,
} from './referenceData'

const VIRTUAL_ROW_COUNT = 250_000

/**
 * Reference example 19 deliberately exposes a quarter-million logical rows without
 * materializing widgets for them. The browser version keeps the same model:
 * only the rows intersecting the scroll viewport are mounted.
 */
export function VirtualFeatureTableExampleApp() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const virtualizer = useVirtualizer({
    count: VIRTUAL_ROW_COUNT,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 27,
    overscan: 12,
  })
  const selectedPreview = Array.from(selected)
    .slice(0, 8)
    .map((row) => `pt_${row}`)

  const chooseRow = (
    row: number,
    event: ReactMouseEvent<HTMLButtonElement>
  ): void => {
    if (event.shiftKey && anchorRef.current != null) {
      const first = Math.min(anchorRef.current, row)
      const last = Math.max(anchorRef.current, row)
      const range = new Set<number>()
      for (let index = first; index <= last; index += 1) range.add(index)
      if (event.ctrlKey || event.metaKey) {
        setSelected((current) => new Set([...current, ...range]))
      } else {
        setSelected(range)
      }
      return
    }
    anchorRef.current = row
    if (event.ctrlKey || event.metaKey) {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(row)) next.delete(row)
        else next.add(row)
        return next
      })
    } else {
      setSelected(new Set([row]))
    }
  }

  return (
    <div className="reference-example-window reference-virtual-table-window">
      <section className="reference-table-frame">
        <div className="reference-table-header reference-virtual-columns">
          <span>Feature ID</span>
          <span>Value</span>
          <span>Bucket</span>
        </div>
        <div className="reference-table-scroll" ref={scrollRef}>
          <div
            className="reference-table-spacer"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = item.index
              return (
                <button
                  type="button"
                  className={`reference-table-row reference-virtual-columns ${
                    selected.has(row) ? 'is-selected' : ''
                  }`}
                  key={row}
                  style={{ transform: `translateY(${item.start}px)` }}
                  onClick={(event) => chooseRow(row, event)}
                >
                  <span>pt_{row}</span>
                  <span>{row}</span>
                  <span>{Math.floor(row / 100)}</span>
                </button>
              )
            })}
          </div>
        </div>
      </section>
      <p className="reference-table-status">
        {selected.size
          ? `Selected ${selected.size.toLocaleString()} rows: ${selectedPreview.join(
              ', '
            )}${selected.size > 8 ? '...' : ''}`
          : 'Select table rows to see selected keys.'}
      </p>
      <button
        type="button"
        className="reference-wide-button"
        onClick={() => {
          setSelected(
            new Set(Array.from({ length: 11 }, (_, index) => index + 10))
          )
          anchorRef.current = 10
          virtualizer.scrollToIndex(10, { align: 'center' })
        }}
      >
        Select rows 10-20 via feature IDs
      </button>
    </div>
  )
}

type ActivityRecord = {
  id: number
  activity: string
  longitude: number
  latitude: number
  time: number
}

const ACTIVITY_START = Date.UTC(2024, 0, 1) / 1000
const ACTIVITY_END = ACTIVITY_START + 30 * 86_400
const ACTIVITY_COUNT = 6_000

function normalRandom(random: () => number): number {
  const first = Math.max(Number.EPSILON, random())
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random())
}

function buildActivityRecords(): ActivityRecord[] {
  const random = createReferenceRandom(7)
  const clusters = [
    { center: ACTIVITY_START + 2 * 86_400, weight: 0.35, name: 'Early surge' },
    { center: ACTIVITY_START + 11 * 86_400, weight: 0.25, name: 'Mid-month' },
    { center: ACTIVITY_START + 20 * 86_400, weight: 0.3, name: 'Late surge' },
    { center: ACTIVITY_START + 28 * 86_400, weight: 0.1, name: 'Cleanup' },
  ] as const
  // Keep the same vectorized RNG call order as the Reference source.
  const latitudes = Array.from(
    { length: ACTIVITY_COUNT },
    () => 32 + random() * 15
  )
  const longitudes = Array.from(
    { length: ACTIVITY_COUNT },
    () => -125 + random() * 15
  )
  const choices = Array.from({ length: ACTIVITY_COUNT }, () => random())
  return Array.from({ length: ACTIVITY_COUNT }, (_, id) => {
    const choice = choices[id]
    let cumulative = 0
    let cluster = clusters[clusters.length - 1]
    for (const candidate of clusters) {
      cumulative += candidate.weight
      if (choice <= cumulative) {
        cluster = candidate
        break
      }
    }
    const time = Math.max(
      ACTIVITY_START,
      Math.min(ACTIVITY_END, cluster.center + normalRandom(random) * 28 * 3600)
    )
    return {
      id,
      activity: cluster.name,
      longitude: longitudes[id],
      latitude: latitudes[id],
      time,
    }
  })
}

type ActivityTableProps = {
  rows: readonly ActivityRecord[]
  visibleIndices: readonly number[]
  selected: ReadonlySet<number>
  onSelect: (indices: readonly number[], additive: boolean) => void
}

function ActivityTable({
  rows,
  visibleIndices,
  selected,
  onSelect,
}: ActivityTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<number | null>(null)
  const [sort, setSort] = useState<{
    column: 'id' | 'activity' | 'time'
    descending: boolean
  }>({ column: 'id', descending: false })
  const displayIndices = useMemo(() => {
    const output = [...visibleIndices]
    output.sort((first, second) => {
      const firstValue =
        sort.column === 'id'
          ? first
          : sort.column === 'time'
            ? rows[first].time
            : rows[first].activity
      const secondValue =
        sort.column === 'id'
          ? second
          : sort.column === 'time'
            ? rows[second].time
            : rows[second].activity
      const comparison =
        typeof firstValue === 'number'
          ? firstValue - (secondValue as number)
          : firstValue.localeCompare(secondValue as string)
      return sort.descending ? -comparison : comparison
    })
    return output
  }, [rows, sort, visibleIndices])
  const virtualizer = useVirtualizer({
    count: displayIndices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 27,
    overscan: 12,
  })
  const firstSelected = selected.values().next().value as number | undefined

  useEffect(() => {
    if (firstSelected == null) return
    const row = displayIndices.indexOf(firstSelected)
    if (row >= 0) virtualizer.scrollToIndex(row, { align: 'auto' })
  }, [displayIndices, firstSelected, virtualizer])

  const changeSort = (column: typeof sort.column): void => {
    setSort((current) => ({
      column,
      descending: current.column === column ? !current.descending : false,
    }))
  }

  return (
    <section className="reference-table-frame">
      <div className="reference-table-header reference-activity-columns">
        {(['id', 'activity', 'time'] as const).map((column) => (
          <button type="button" key={column} onClick={() => changeSort(column)}>
            {column === 'id'
              ? 'ID'
              : column === 'activity'
                ? 'Activity'
                : 'Timestamp'}
            {sort.column === column ? (sort.descending ? ' ▼' : ' ▲') : ''}
          </button>
        ))}
      </div>
      <div className="reference-table-scroll" ref={scrollRef}>
        <div
          className="reference-table-spacer"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const index = displayIndices[item.index]
            const row = rows[index]
            return (
              <button
                type="button"
                className={`reference-table-row reference-activity-columns ${
                  selected.has(index) ? 'is-selected' : ''
                }`}
                key={index}
                style={{ transform: `translateY(${item.start}px)` }}
                onClick={(event) => {
                  const additive = event.ctrlKey || event.metaKey
                  if (event.shiftKey && anchorRef.current != null) {
                    const first = Math.min(anchorRef.current, item.index)
                    const last = Math.max(anchorRef.current, item.index)
                    onSelect(displayIndices.slice(first, last + 1), additive)
                  } else {
                    anchorRef.current = item.index
                    onSelect([index], additive)
                  }
                }}
              >
                <span>time_point_{row.id}</span>
                <span>{row.activity}</span>
                <span>{formatFullTimestamp(row.time)}</span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** Source-matched port of examples/20_time_histogram_slider.py. */
export function TimeHistogramExampleApp() {
  const mapRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<FastPointEngine | null>(null)
  const records = useMemo(buildActivityRecords, [])
  const timeValues = useMemo(
    () => Float64Array.from(records, (record) => record.time),
    [records]
  )
  const timeMinimum = useMemo(() => Math.min(...timeValues), [timeValues])
  const timeMaximum = useMemo(() => Math.max(...timeValues), [timeValues])
  const histogram = useMemo(
    () => buildFineTimeHistogram(timeValues, timeMinimum, timeMaximum),
    [timeMaximum, timeMinimum, timeValues]
  )
  const [filterRange, setFilterRange] = useState<[number, number]>([
    timeMinimum,
    timeMaximum,
  ])
  const [viewRange, setViewRange] = useState<[number, number]>([
    timeMinimum,
    timeMaximum,
  ])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const visibleIndices = useMemo(() => {
    const output: number[] = []
    for (const record of records) {
      if (record.time >= filterRange[0] && record.time <= filterRange[1]) {
        output.push(record.id)
      }
    }
    return output
  }, [filterRange, records])

  useEffect(() => {
    if (!mapRef.current) return
    const engine = new FastPointEngine({
      target: mapRef.current,
      onSelectionChange: () => {
        setSelected(new Set(engine.selectedIndices()))
      },
    })
    engineRef.current = engine
    const { dataset, summary } = createReferenceDataset(
      'Time histogram sample',
      records.map((record) => ({
        longitude: record.longitude,
        latitude: record.latitude,
        time: record.time,
        color: packRgba(30, 144, 255, 180),
      }))
    )
    engine.loadDataset(dataset, summary)
    engine.setPointStyle({
      radius: 4,
      selectedRadius: 7,
      selectedColor: packRgba(255, 255, 0),
    })
    engine.map.getView().setCenter(fromLonLat([-120, 37]))
    engine.map.getView().setZoom(6)
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [records])

  useEffect(() => {
    engineRef.current?.setTimeRange(filterRange[0], filterRange[1])
  }, [filterRange])

  const selectRows = (indices: readonly number[], additive: boolean): void => {
    const engine = engineRef.current
    if (!engine || indices.length === 0) return
    if (additive && indices.length === 1) engine.toggleIndex(indices[0])
    else engine.selectIndices(indices, !additive)

    const last = indices[indices.length - 1]
    const coordinate: [number, number] = [
      engine.snapshot.x[last],
      engine.snapshot.y[last],
    ]
    const size = engine.map.getSize()
    if (
      size &&
      !containsCoordinate(
        engine.map.getView().calculateExtent(size),
        coordinate
      )
    ) {
      engine.map.getView().animate({ center: coordinate, duration: 180 })
    }
  }

  const reset = (): void => {
    setFilterRange([timeMinimum, timeMaximum])
    setViewRange([timeMinimum, timeMaximum])
  }

  return (
    <div className="reference-example-window reference-time-histogram-window">
      <main className="reference-time-histogram-layout">
        <ActivityTable
          rows={records}
          visibleIndices={visibleIndices}
          selected={selected}
          onSelect={selectRows}
        />
        <section className="reference-time-map-column">
          <div className="reference-map-fill" ref={mapRef} />
          <HistogramRange
            bins={histogram}
            minimum={timeMinimum}
            maximum={timeMaximum}
            start={filterRange[0]}
            end={filterRange[1]}
            viewStart={viewRange[0]}
            viewEnd={viewRange[1]}
            onChange={(start, end) => setFilterRange([start, end])}
            onViewChange={(start, end) => setViewRange([start, end])}
          />
          <p className="reference-time-info">
            Showing {visibleIndices.length.toLocaleString()} /{' '}
            {records.length.toLocaleString()} points | Hidden:{' '}
            {(records.length - visibleIndices.length).toLocaleString()} | Wheel
            over the plot to zoom and re-aggregate the histogram.
          </p>
          <button
            type="button"
            className="reference-wide-button"
            onClick={reset}
          >
            Reset Time Filter
          </button>
        </section>
      </main>
    </div>
  )
}
