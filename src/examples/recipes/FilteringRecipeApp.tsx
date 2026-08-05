import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {VirtualDataTable, type VirtualDataTableColumn} from "../../widgets/VirtualDataTable";
import {containsCoordinate} from "ol/extent.js";
import {fromLonLat} from "ol/proj.js";
import type {DatasetSummary, PackedDataset} from "../../lib/types";
import {buildCompactSpatialIndex} from "../../map/compactIndex";
import {FastPointEngine} from "../../map/FastPointEngine";
import {createSeededRandom} from "../data/sampleData";

type FilterRow = {
  id: number;
  longitude: number;
  latitude: number;
  value: number;
  time: number;
};

type FilterResult = {
  mask: Uint8Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
};

const POINT_COUNT = 5_000;
const START_TIME = Date.UTC(2024, 0, 1) / 1000;
const END_TIME = START_TIME + 30 * 24 * 3600;

function packedColor(value: number): number {
  const ratio = value / 100;
  const red = ratio < 0.5 ? Math.trunc(255 * ratio * 2) : 255;
  const green =
    ratio < 0.5 ? 255 : Math.trunc(255 * (1 - (ratio - 0.5) * 2));
  return ((red << 24) | (green << 16) | (0 << 8) | 200) >>> 0;
}

function buildRows(): FilterRow[] {
  const random = createSeededRandom(42);
  const latitudes = Array.from(
    {length: POINT_COUNT},
    () => 32 + random() * 15,
  );
  const longitudes = Array.from(
    {length: POINT_COUNT},
    () => -125 + random() * 15,
  );
  const values = Array.from(
    {length: POINT_COUNT},
    () => random() * 100,
  );
  const times = Array.from(
    {length: POINT_COUNT},
    () => START_TIME + random() * (END_TIME - START_TIME),
  );
  return Array.from({length: POINT_COUNT}, (_, id) => ({
    id,
    latitude: latitudes[id],
    longitude: longitudes[id],
    value: values[id],
    time: times[id],
  }));
}

function buildDataset(rows: readonly FilterRow[]): {
  dataset: PackedDataset;
  summary: DatasetSummary;
} {
  const x = new Float64Array(rows.length);
  const y = new Float64Array(rows.length);
  const time = new Float64Array(rows.length);
  const colors = new Uint32Array(rows.length);
  const extent: [number, number, number, number] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
  ];
  for (const row of rows) {
    const coordinate = fromLonLat([row.longitude, row.latitude]);
    x[row.id] = coordinate[0];
    y[row.id] = coordinate[1];
    time[row.id] = row.time;
    colors[row.id] = packedColor(row.value);
    extent[0] = Math.min(extent[0], coordinate[0]);
    extent[1] = Math.min(extent[1], coordinate[1]);
    extent[2] = Math.max(extent[2], coordinate[0]);
    extent[3] = Math.max(extent[3], coordinate[1]);
  }
  return {
    dataset: {
      x,
      y,
      semiMajor: new Float32Array(rows.length),
      semiMinor: new Float32Array(rows.length),
      rotation: new Float32Array(rows.length),
      time,
      colors,
      timeHistogram: new Uint32Array(),
      extent,
      index: buildCompactSpatialIndex(x, y),
    },
    summary: {
      name: "Range slider sample",
      rowCount: rows.length,
      timeMin: START_TIME,
      timeMax: END_TIME,
      invalidRows: 0,
      invalidTimestamps: 0,
      coordinateFailures: 0,
      projectionClampedRows: 0,
    },
  };
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

type FilterTableProps = {
  rows: readonly FilterRow[];
  indices: Uint32Array;
  selected: ReadonlySet<number>;
  onSelect: (ids: readonly number[], additive: boolean) => void;
};

const filterTableColumns: readonly VirtualDataTableColumn<FilterRow>[] = [
  {key: "id", heading: "ID", sortValue: (row) => row.id, render: (row) => `point_${row.id}`},
  {key: "value", heading: "Value", sortValue: (row) => row.value, render: (row) => row.value.toFixed(1)},
  {key: "time", heading: "Timestamp", sortValue: (row) => row.time, render: (row) => formatTimestamp(row.time)},
];

function FilterTable({rows, indices, selected, onSelect}: FilterTableProps) {
  const displayRows = useMemo(() => Array.from(indices, (index) => rows[index]), [indices, rows]);
  return (
    <VirtualDataTable
      rows={displayRows}
      columns={filterTableColumns}
      rowKey={(row) => row.id}
      selected={selected}
      selectionKey={(row) => row.id}
      onSelection={onSelect}
      className="filter-table-panel"
      headerClassName="filter-table-header"
      rowClassName=""
      scrollClassName="filter-table-scroll"
      spacerClassName="filter-table-spacer"
      estimateSize={29}
      initialSort={{column: 0, descending: false}}
    />
  );
}

export function FilteringDemoApp() {
  const mapRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLElement>(null);
  const engineRef = useRef<FastPointEngine | null>(null);
  const rows = useMemo(buildRows, []);
  const timeMinimum = useMemo(
    () => Math.min(...rows.map((row) => row.time)),
    [rows],
  );
  const timeMaximum = useMemo(
    () => Math.max(...rows.map((row) => row.time)),
    [rows],
  );
  const [valueRange, setValueRange] = useState<[number, number]>([0, 100]);
  const [timeRange, setTimeRange] = useState<[number, number]>([
    timeMinimum,
    timeMaximum,
  ]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [tablePercent, setTablePercent] = useState(33.33);

  const filtered = useMemo<FilterResult>(() => {
    const mask = new Uint8Array(rows.length);
    const matching = new Uint32Array(rows.length);
    let count = 0;
    for (const row of rows) {
      if (
        row.value < valueRange[0] ||
        row.value > valueRange[1] ||
        row.time < timeRange[0] ||
        row.time > timeRange[1]
      ) {
        continue;
      }
      mask[row.id] = 1;
      matching[count++] = row.id;
    }
    return {
      mask,
      indices: matching.slice(0, count) as Uint32Array<ArrayBuffer>,
    };
  }, [rows, timeRange, valueRange]);

  useEffect(() => {
    if (!mapRef.current) return;
    const engine = new FastPointEngine({
      target: mapRef.current,
      onSelectionChange: () => {
        const selected = new Set<number>();
        const selectionMask = engine.snapshot.selected;
        for (let index = 0; index < selectionMask.length; index += 1) {
          if (selectionMask[index]) selected.add(index);
        }
        setSelectedIds(selected);
      },
    });
    engineRef.current = engine;
    const {dataset, summary} = buildDataset(rows);
    engine.loadDataset(dataset, summary);
    engine.setPointStyle({
      radius: 4,
      selectedRadius: 7,
      selectedColor: 0xffff00ff,
    });
    engine.setCollapsePixels(1);
    // Example 10 is a FastPointsLayer, not a FastGeoPointsLayer. Avoid the
    // ellipse pass entirely during pan/zoom renders.
    engine.setEllipsesVisible(false);
    engine.setSelectedEllipsesVisible(false);
    engine.map.getView().setCenter(fromLonLat([-120, 37]));
    engine.map.getView().setZoom(6);
    const observer = new ResizeObserver(() => engine.map.updateSize());
    observer.observe(mapRef.current);
    return () => {
      observer.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, [rows]);

  useEffect(() => {
    engineRef.current?.setVisibilityMask(filtered.mask);
  }, [filtered.mask]);

  const selectTableRows = (
    ids: readonly number[],
    additive: boolean,
  ): void => {
    const engine = engineRef.current;
    if (!engine || ids.length === 0) return;
    if (additive && ids.length === 1) engine.toggleIndex(ids[0]);
    else engine.selectIndices(ids, !additive);

    const id = ids[ids.length - 1];
    const coordinate: [number, number] = [
      engine.snapshot.x[id],
      engine.snapshot.y[id],
    ];
    const view = engine.map.getView();
    const size = engine.map.getSize();
    if (
      ids.length === 1 ||
      (size && !containsCoordinate(view.calculateExtent(size), coordinate))
    ) {
      view.animate({center: coordinate, duration: 180});
    }
  };

  return (
    <div className="reference-example-window filter-reference-window">
      <main className="filter-example-content">
        <section className="filter-sliders-panel">
          <div>
            <h2>Filter by Value</h2>
            <div className="dual-range-values">
              <strong>{valueRange[0].toFixed(1)}</strong>
              <span>through</span>
              <strong>{valueRange[1].toFixed(1)}</strong>
            </div>
            <div className="filter-range-pair">
              <input
                aria-label="Minimum numeric value"
                type="range"
                min="0"
                max="100"
                step="1"
                value={valueRange[0]}
                onChange={(event) =>
                  setValueRange([
                    Math.min(Number(event.target.value), valueRange[1]),
                    valueRange[1],
                  ])
                }
              />
              <input
                aria-label="Maximum numeric value"
                type="range"
                min="0"
                max="100"
                step="1"
                value={valueRange[1]}
                onChange={(event) =>
                  setValueRange([
                    valueRange[0],
                    Math.max(Number(event.target.value), valueRange[0]),
                  ])
                }
              />
            </div>
          </div>
          <div>
            <h2>Filter by Timestamp</h2>
            <div className="dual-range-values time-values">
              <strong>{formatTimestamp(timeRange[0])}</strong>
              <strong>{formatTimestamp(timeRange[1])}</strong>
            </div>
            <div className="filter-range-pair">
              <input
                aria-label="Minimum timestamp"
                type="range"
                min={timeMinimum}
                max={timeMaximum}
                step="3600"
                value={timeRange[0]}
                onChange={(event) =>
                  setTimeRange([
                    Math.min(Number(event.target.value), timeRange[1]),
                    timeRange[1],
                  ])
                }
              />
              <input
                aria-label="Maximum timestamp"
                type="range"
                min={timeMinimum}
                max={timeMaximum}
                step="3600"
                value={timeRange[1]}
                onChange={(event) =>
                  setTimeRange([
                    timeRange[0],
                    Math.max(Number(event.target.value), timeRange[0]),
                  ])
                }
              />
            </div>
          </div>
          <p>
            {valueRange[0] === 0 &&
            valueRange[1] === 100 &&
            timeRange[0] === timeMinimum &&
            timeRange[1] === timeMaximum
              ? `Total: ${rows.length.toLocaleString()} points | Use sliders to filter by value and timestamp`
              : `Showing ${filtered.indices.length.toLocaleString()} / ${rows.length.toLocaleString()} points | Hidden: ${(rows.length - filtered.indices.length).toLocaleString()}`}
          </p>
          <button
            className="filter-reset-button"
            onClick={() => {
              setValueRange([0, 100]);
              setTimeRange([timeMinimum, timeMaximum]);
            }}
          >
            Reset All Filters
          </button>
        </section>
        <section
          className="filter-split-content"
          ref={splitRef}
          style={{
            gridTemplateColumns:
              `minmax(260px, ${tablePercent}%) 6px minmax(0, 1fr)`,
          }}
        >
          <FilterTable
            rows={rows}
            indices={filtered.indices}
            selected={selectedIds}
            onSelect={selectTableRows}
          />
          <div
            className="reference-column-separator"
            role="separator"
            aria-label="Resize table and map"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.classList.add("is-dragging");
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                return;
              }
              const bounds = splitRef.current?.getBoundingClientRect();
              if (!bounds || bounds.width <= 0) return;
              const percent =
                ((event.clientX - bounds.left) / bounds.width) * 100;
              setTablePercent(Math.max(20, Math.min(70, percent)));
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              event.currentTarget.classList.remove("is-dragging");
            }}
            onPointerCancel={(event) => {
              event.currentTarget.classList.remove("is-dragging");
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setTablePercent((current) => Math.max(20, current - 2));
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                setTablePercent((current) => Math.min(70, current + 2));
              }
            }}
          />
          <div className="filter-map" ref={mapRef} />
        </section>
      </main>
    </div>
  );
}
