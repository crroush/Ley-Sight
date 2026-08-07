import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {DataGrid, type DataGridColumn} from '../../toolkit/widgets';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import VectorLayer from 'ol/layer/Vector.js';
import {fromLonLat} from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style.js';
import {FastPointEngine} from '../../toolkit/map';
import {
  createSampleDataset,
  createSeededRandom,
  packRgba,
} from '../data/sampleData';

type IntegratedRow = {
  key: string;
  layer: 'cities' | 'measurements' | 'geo_points';
  type: 'point' | 'geo_point';
  id: string;
  value: string;
  latitude: number;
  longitude: number;
  semiMajor?: number;
  semiMinor?: number;
  tilt?: number;
  color: number;
};

const INITIAL_CITIES: IntegratedRow[] = [
  {
    key: 'cities:city_0',
    layer: 'cities',
    type: 'point',
    id: 'city_0',
    value: 'San Francisco',
    latitude: 37.7749,
    longitude: -122.4194,
    color: packRgba(255, 0, 0),
  },
  {
    key: 'cities:city_1',
    layer: 'cities',
    type: 'point',
    id: 'city_1',
    value: 'Los Angeles',
    latitude: 34.0522,
    longitude: -118.2437,
    color: packRgba(255, 0, 0),
  },
  {
    key: 'cities:city_2',
    layer: 'cities',
    type: 'point',
    id: 'city_2',
    value: 'Seattle',
    latitude: 47.6062,
    longitude: -122.3321,
    color: packRgba(255, 0, 0),
  },
];

type IntegrationTableProps = {
  rows: readonly IntegratedRow[];
  selected: ReadonlySet<string>;
  onSelection: (keys: readonly string[], additive: boolean) => void;
  onContextMenu: (x: number, y: number, key: string) => void;
};

function IntegrationTable({
  rows,
  selected,
  onSelection,
  onContextMenu,
}: IntegrationTableProps) {
  const rowsByKey = useMemo(
    () => new Map(rows.map((row) => [row.key, row])),
    [rows]
  );
  const columns = useMemo<readonly DataGridColumn<string>[]>(
    () =>
      (['layer', 'type', 'id', 'value'] as const).map((column) => ({
        key: column,
        label: column[0].toUpperCase() + column.slice(1),
        sortValue: (key: string) => rowsByKey.get(key)![column],
        renderCell: (key: string) => rowsByKey.get(key)![column],
      })),
    [rowsByKey]
  );
  return (
    <DataGrid
      columns={columns}
      rowSource={{
        rowCount: rows.length,
        rowIdAt: (position) => rows[position].key,
      }}
      selection={{isSelected: (key) => selected.has(key), onSelection}}
      initialSort={{columnKey: 'layer', direction: 'ascending'}}
      headerClassName="reference-table-header reference-integration-columns"
      rowClassName="reference-table-row reference-integration-columns"
      onRowContextMenu={(x, y, key) => onContextMenu(x, y, key)}
    />
  );
}

/** Source-matched port of examples/08_table_integration.py. */
export function TableIntegrationExampleApp() {
  const mapRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const engineRef = useRef<FastPointEngine | null>(null);
  const citySourceRef = useRef(new VectorSource());
  const cityLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const engineKeysRef = useRef<string[]>([]);
  const selectedRef = useRef(new Set<string>());
  const syncingRef = useRef(false);
  const countersRef = useRef({city: 3, measurement: 0, geo: 0});
  const randomRef = useRef(createSeededRandom(42));
  const [rows, setRows] = useState<IntegratedRow[]>(INITIAL_CITIES);
  const rowsRef = useRef(rows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [vectorCount, setVectorCount] = useState(5);
  const [fastCount, setFastCount] = useState(100_000);
  const [geoCount, setGeoCount] = useState(100_000);
  const [allEllipses, setAllEllipses] = useState(true);
  const [selectedEllipses, setSelectedEllipses] = useState(false);
  const [menu, setMenu] = useState<{x: number; y: number} | null>(null);
  const [controlsPercent, setControlsPercent] = useState(16.67);
  const [tableEndPercent, setTableEndPercent] = useState(50);
  rowsRef.current = rows;
  selectedRef.current = selected;

  const rebuildEngine = useCallback(
    (nextRows: readonly IntegratedRow[], selection: ReadonlySet<string>) => {
      const engine = engineRef.current;
      if (!engine) return;
      const mapped = nextRows.filter((row) => row.layer !== 'cities');
      engineKeysRef.current = mapped.map((row) => row.key);
      if (mapped.length === 0) {
        syncingRef.current = true;
        engine.clear();
        syncingRef.current = false;
        return;
      }
      const {dataset, summary} = createSampleDataset(
        'Interactive map-table rows',
        mapped.map((row) => ({
          latitude: row.latitude,
          longitude: row.longitude,
          semiMajor: row.semiMajor,
          semiMinor: row.semiMinor,
          tilt: row.tilt,
          color: row.color,
        }))
      );
      syncingRef.current = true;
      engine.loadDataset(dataset, summary);
      const indices: number[] = [];
      for (let index = 0; index < mapped.length; index += 1) {
        if (selection.has(mapped[index].key)) indices.push(index);
      }
      engine.selectIndices(indices, true);
      syncingRef.current = false;
    },
    []
  );

  const updateCityFeatures = useCallback(
    (nextRows: readonly IntegratedRow[]) => {
      const source = citySourceRef.current;
      source.clear();
      source.addFeatures(
        nextRows
          .filter((row) => row.layer === 'cities')
          .map((row) => {
            const feature = new Feature(
              new Point(fromLonLat([row.longitude, row.latitude]))
            );
            feature.set('rowKey', row.key);
            return feature;
          })
      );
    },
    []
  );

  useEffect(() => {
    if (!mapRef.current) return;
    const engine = new FastPointEngine({
      target: mapRef.current,
      onSelectionChange: () => {
        if (syncingRef.current) return;
        const next = new Set(
          [...selectedRef.current].filter((key) => key.startsWith('cities:'))
        );
        for (const index of engine.selectedIndices()) {
          const key = engineKeysRef.current[index];
          if (key) next.add(key);
        }
        setSelected(next);
      },
    });
    engineRef.current = engine;
    engine.setPointStyle({
      radius: 4,
      selectedRadius: 7,
      selectedColor: packRgba(216, 27, 96),
    });
    engine.setCollapsePixels(4);
    engine.map.getView().setCenter(fromLonLat([-120, 37]));
    engine.map.getView().setZoom(6);
    const cityLayer = new VectorLayer({
      source: citySourceRef.current,
      style: (feature) => {
        const isSelected = selectedRef.current.has(
          String(feature.get('rowKey'))
        );
        return new Style({
          image: new CircleStyle({
            radius: isSelected ? 12 : 10,
            fill: new Fill({color: isSelected ? 'yellow' : 'red'}),
            stroke: new Stroke({color: 'darkred', width: 2}),
          }),
        });
      },
    });
    cityLayer.setZIndex(20);
    cityLayerRef.current = cityLayer;
    engine.map.addLayer(cityLayer);
    updateCityFeatures(INITIAL_CITIES);
    engine.map.on('singleclick', (event) => {
      const feature = engine.map.forEachFeatureAtPixel(
        event.pixel,
        (candidate) => candidate,
        {layerFilter: (candidate) => candidate === cityLayer}
      );
      if (!feature) return;
      const key = String(feature.get('rowKey'));
      setSelected((current) => {
        const next = new Set(
          [...current].filter((candidate) => !candidate.startsWith('cities:'))
        );
        next.add(key);
        return next;
      });
    });
    const observer = new ResizeObserver(() => engine.map.updateSize());
    observer.observe(mapRef.current);
    return () => {
      observer.disconnect();
      engine.dispose();
    };
  }, [updateCityFeatures]);

  useEffect(() => {
    cityLayerRef.current?.changed();
  }, [selected]);

  useEffect(() => {
    engineRef.current?.setEllipsesVisible(allEllipses);
    engineRef.current?.setSelectedEllipsesVisible(
      allEllipses || selectedEllipses
    );
  }, [allEllipses, selectedEllipses]);

  useEffect(() => {
    const deleteKey = (event: KeyboardEvent): void => {
      if (event.key === 'Delete') deleteSelected();
    };
    window.addEventListener('keydown', deleteKey);
    return () => window.removeEventListener('keydown', deleteKey);
  });

  const applyTableSelection = (
    keys: readonly string[],
    additive: boolean
  ): void => {
    const next = additive ? new Set(selectedRef.current) : new Set<string>();
    for (const key of keys) {
      if (additive && next.has(key)) next.delete(key);
      else next.add(key);
    }
    setSelected(next);
    const engine = engineRef.current;
    if (engine) {
      const engineIndices: number[] = [];
      for (let index = 0; index < engineKeysRef.current.length; index += 1) {
        if (next.has(engineKeysRef.current[index])) engineIndices.push(index);
      }
      syncingRef.current = true;
      engine.selectIndices(engineIndices, true);
      syncingRef.current = false;
    }
  };

  const appendRows = (added: IntegratedRow[]): void => {
    const next = [...rowsRef.current, ...added];
    rowsRef.current = next;
    setRows(next);
    updateCityFeatures(next);
    rebuildEngine(next, selectedRef.current);
  };

  const addCities = (): void => {
    const random = randomRef.current;
    const added: IntegratedRow[] = [];
    for (let index = 0; index < vectorCount; index += 1) {
      const counter = countersRef.current.city;
      countersRef.current.city += 1;
      added.push({
        key: `cities:city_${counter}`,
        layer: 'cities',
        type: 'point',
        id: `city_${counter}`,
        value: `City #${countersRef.current.city}`,
        latitude: 32.5 + random() * 10,
        longitude: -124 + random() * 10,
        color: packRgba(255, 0, 0),
      });
    }
    appendRows(added);
  };

  const addMeasurements = (): void => {
    const random = randomRef.current;
    const added: IntegratedRow[] = [];
    for (let index = 0; index < fastCount; index += 1) {
      const counter = countersRef.current.measurement++;
      added.push({
        key: `measurements:meas_${counter}`,
        layer: 'measurements',
        type: 'point',
        id: `meas_${counter}`,
        value: (random() * 100).toFixed(1),
        latitude: 32 + random() * 15,
        longitude: -125 + random() * 15,
        color: packRgba(0, 128, 0),
      });
    }
    appendRows(added);
  };

  const addGeoPoints = (): void => {
    const random = randomRef.current;
    const added: IntegratedRow[] = [];
    for (let index = 0; index < geoCount; index += 1) {
      const counter = countersRef.current.geo++;
      const semiMajor = 500 + random() * 3500;
      added.push({
        key: `geo_points:geo_${counter}`,
        layer: 'geo_points',
        type: 'geo_point',
        id: `geo_${counter}`,
        value: `σ=${semiMajor.toFixed(0)}m`,
        latitude: 32 + random() * 15,
        longitude: -125 + random() * 15,
        semiMajor,
        semiMinor: 250 + random() * 1750,
        tilt: random() * 360,
        color: packRgba(30, 136, 229),
      });
    }
    appendRows(added);
  };

  function deleteSelected(): void {
    if (selectedRef.current.size === 0) return;
    const nextRows = rowsRef.current.filter(
      (row) => !selectedRef.current.has(row.key)
    );
    rowsRef.current = nextRows;
    setRows(nextRows);
    setSelected(new Set());
    updateCityFeatures(nextRows);
    rebuildEngine(nextRows, new Set());
    setMenu(null);
  }

  return (
    <div className="reference-example-window reference-integration-window">
      <p className="reference-link-info">
        Add points to any layer type, select them on map or table, and delete
        with button or Delete key. Use ellipse checkboxes to hide all ellipses
        or show only selected ellipses. Demonstrates full CRUD operations with
        bidirectional sync.
      </p>
      <main
        className="reference-integration-layout"
        ref={layoutRef}
        style={{
          gridTemplateColumns:
            `minmax(190px, ${controlsPercent}%) 6px ` +
            `minmax(300px, ${tableEndPercent - controlsPercent}%) 6px ` +
            'minmax(0, 1fr)',
        }}
      >
        <aside className="reference-integration-controls">
          <strong>Layer Controls</strong>
          <fieldset>
            <legend>Vector Layer (Cities)</legend>
            <label>Number of cities:</label>
            <input
              type="number"
              min="1"
              max="1000"
              value={vectorCount}
              onChange={(event) => setVectorCount(Number(event.target.value))}
            />
            <button type="button" onClick={addCities}>
              Add Cities
            </button>
          </fieldset>
          <fieldset>
            <legend>FastPoints Layer (Measurements)</legend>
            <label>Number of measurements:</label>
            <input
              type="number"
              min="1"
              max="5000000"
              value={fastCount}
              onChange={(event) => setFastCount(Number(event.target.value))}
            />
            <button type="button" onClick={addMeasurements}>
              Add Measurements
            </button>
          </fieldset>
          <fieldset>
            <legend>FastGeoPoints Layer (Uncertainty)</legend>
            <label>Number of geo points:</label>
            <input
              type="number"
              min="1"
              max="5000000"
              value={geoCount}
              onChange={(event) => setGeoCount(Number(event.target.value))}
            />
            <button type="button" onClick={addGeoPoints}>
              Add Geo Points
            </button>
            <label>
              <input
                type="checkbox"
                checked={allEllipses}
                onChange={(event) => setAllEllipses(event.target.checked)}
              />
              Show All Ellipses
            </label>
            <label>
              <input
                type="checkbox"
                checked={selectedEllipses}
                onChange={(event) => setSelectedEllipses(event.target.checked)}
              />
              Show Selected Ellipses
            </label>
          </fieldset>
          <button
            type="button"
            className="reference-delete-button"
            onClick={deleteSelected}
          >
            Delete Selected (or press Delete key)
          </button>
          <span>Total features: {rows.length.toLocaleString()}</span>
        </aside>
        <div
          className="reference-column-separator"
          role="separator"
          aria-label="Resize controls and table"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.classList.add('is-dragging');
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const bounds = layoutRef.current?.getBoundingClientRect();
            if (!bounds || bounds.width <= 0) return;
            const percent =
              ((event.clientX - bounds.left) / bounds.width) * 100;
            setControlsPercent(
              Math.max(12, Math.min(tableEndPercent - 18, percent))
            );
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            event.currentTarget.classList.remove('is-dragging');
          }}
          onPointerCancel={(event) =>
            event.currentTarget.classList.remove('is-dragging')
          }
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              setControlsPercent((current) => Math.max(12, current - 2));
            } else if (event.key === 'ArrowRight') {
              setControlsPercent((current) =>
                Math.min(tableEndPercent - 18, current + 2)
              );
            } else {
              return;
            }
            event.preventDefault();
          }}
        />
        <IntegrationTable
          rows={rows}
          selected={selected}
          onSelection={applyTableSelection}
          onContextMenu={(x, y, key) => {
            if (!selectedRef.current.has(key))
              applyTableSelection([key], false);
            setMenu({x, y});
          }}
        />
        <div
          className="reference-column-separator"
          role="separator"
          aria-label="Resize table and map"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.classList.add('is-dragging');
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const bounds = layoutRef.current?.getBoundingClientRect();
            if (!bounds || bounds.width <= 0) return;
            const percent =
              ((event.clientX - bounds.left) / bounds.width) * 100;
            setTableEndPercent(
              Math.max(controlsPercent + 18, Math.min(75, percent))
            );
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            event.currentTarget.classList.remove('is-dragging');
          }}
          onPointerCancel={(event) =>
            event.currentTarget.classList.remove('is-dragging')
          }
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              setTableEndPercent((current) =>
                Math.max(controlsPercent + 18, current - 2)
              );
            } else if (event.key === 'ArrowRight') {
              setTableEndPercent((current) => Math.min(75, current + 2));
            } else {
              return;
            }
            event.preventDefault();
          }}
        />
        <div className="reference-map-fill" ref={mapRef} />
      </main>
      {menu && (
        <div
          className="reference-context-menu reference-table-context-menu"
          style={{left: menu.x, top: menu.y}}
        >
          <button
            type="button"
            onClick={() => {
              const chosen = rowsRef.current.filter((row) =>
                selectedRef.current.has(row.key)
              );
              window.alert(
                chosen.map((row) => JSON.stringify(row, null, 2)).join('\n\n')
              );
              setMenu(null);
            }}
          >
            View Metadata
          </button>
          <button type="button" onClick={deleteSelected}>
            Delete Selected
          </button>
          <button
            type="button"
            onClick={() => {
              applyTableSelection([], false);
              setMenu(null);
            }}
          >
            Clear Table Selection
          </button>
        </div>
      )}
    </div>
  );
}
