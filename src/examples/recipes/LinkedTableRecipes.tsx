import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  VirtualDataTable,
  type VirtualDataTableColumn,
} from '../../widgets/VirtualDataTable';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import VectorLayer from 'ol/layer/Vector.js';
import {fromLonLat} from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style.js';
import {FastPointEngine} from '../../map/FastPointEngine';
import {
  createSampleDataset,
  createSeededRandomGenerator,
  packRgba,
} from '../data/sampleData';

type VirtualGridProps = {
  count: number;
  columns: string;
  headings: readonly string[];
  rowKey: (row: number) => string | number;
  cells: (row: number) => readonly ReactNode[];
  sortValues: readonly ((row: number) => string | number)[];
  selected: ReadonlySet<number>;
  onSelection: (rows: readonly number[], additive: boolean) => void;
};

type RowSeparatorProps = {
  containerRef: RefObject<HTMLElement | null>;
  percent: number;
  setPercent: (percent: number) => void;
};

function RowSeparator({containerRef, percent, setPercent}: RowSeparatorProps) {
  return (
    <div
      className="reference-row-separator"
      role="separator"
      aria-label="Resize map and tables"
      aria-orientation="horizontal"
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add('is-dragging');
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = containerRef.current?.getBoundingClientRect();
        if (!bounds || bounds.height <= 0) return;
        setPercent(
          Math.max(
            30,
            Math.min(78, ((event.clientY - bounds.top) / bounds.height) * 100)
          )
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
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setPercent(Math.max(30, percent - 2));
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          setPercent(Math.min(78, percent + 2));
        }
      }}
    />
  );
}

function VirtualGrid({
  count,
  columns,
  headings,
  rowKey,
  cells,
  sortValues,
  selected,
  onSelection,
}: VirtualGridProps) {
  const rows = useMemo(
    () => Array.from({length: count}, (_, row) => row),
    [count]
  );
  const tableColumns = useMemo<readonly VirtualDataTableColumn<number>[]>(
    () =>
      headings.map((heading, column) => ({
        key: column,
        heading,
        sortValue: (row) => sortValues[column](row),
        render: (row) => cells(row)[column],
      })),
    [cells, headings, sortValues]
  );
  return (
    <VirtualDataTable
      rows={rows}
      columns={tableColumns}
      rowKey={(row) => rowKey(row)}
      selected={selected}
      selectionKey={(row) => row}
      onSelection={onSelection}
      gridTemplateColumns={columns}
    />
  );
}

const REGION_SEEDS = [
  ['West', 'Operations', 34.05, -118.24],
  ['Mountain', 'Logistics', 39.74, -104.99],
  ['Midwest', 'Manufacturing', 41.88, -87.63],
  ['East', 'Sales', 40.71, -74],
  ['Pacific NW', 'Research', 47.61, -122.33],
  ['Southwest', 'Field', 33.45, -112.07],
  ['Plains', 'Supply', 39.1, -94.58],
  ['Southeast', 'Support', 33.75, -84.39],
  ['Northeast', 'Product', 42.36, -71.06],
  ['South', 'Delivery', 29.76, -95.36],
] as const;

const SITES_PER_REGION = 10_000;

type SiteData = {
  records: {
    longitude: number;
    latitude: number;
    color: number;
  }[];
  scores: Uint8Array;
};

function buildSites(): SiteData {
  const generator = createSeededRandomGenerator(7);
  const random = generator.random;
  const records: SiteData['records'] = [];
  const scores = new Uint8Array(REGION_SEEDS.length * SITES_PER_REGION);
  let cursor = 0;
  for (const seed of REGION_SEEDS) {
    const [, , latitude, longitude] = seed;
    const latitudes = new Float64Array(SITES_PER_REGION);
    const longitudes = new Float64Array(SITES_PER_REGION);
    for (let index = 0; index < SITES_PER_REGION; index += 1) {
      latitudes[index] = latitude + (random() - 0.5) * 2.2;
    }
    for (let index = 0; index < SITES_PER_REGION; index += 1) {
      longitudes[index] = longitude + (random() - 0.5) * 2.6;
    }
    for (let index = 0; index < SITES_PER_REGION; index += 1) {
      records.push({
        latitude: latitudes[index],
        longitude: longitudes[index],
        color: packRgba(30, 144, 255),
      });
      scores[cursor] = generator.integer(50, 100);
      cursor += 1;
    }
  }
  return {records, scores};
}

/** Source-matched port of examples/13_dual_table_linking.py. */
export function DualTableLinkingExampleApp() {
  const mapRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const engineRef = useRef<FastPointEngine | null>(null);
  const regionLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const syncingRef = useRef(false);
  const selectedRegionsRef = useRef(new Set([0]));
  const sites = useMemo(buildSites, []);
  const [tab, setTab] = useState<'regions' | 'sites'>('regions');
  const [selectedRegions, setSelectedRegions] = useState<Set<number>>(
    new Set([0])
  );
  const [selectedSites, setSelectedSites] = useState<Set<number>>(
    new Set(Array.from({length: SITES_PER_REGION}, (_, index) => index))
  );
  const [mapPercent, setMapPercent] = useState(66.67);
  selectedRegionsRef.current = selectedRegions;

  const setParentSelection = (
    rows: readonly number[],
    additive = false
  ): void => {
    const next = additive
      ? new Set(selectedRegionsRef.current)
      : new Set<number>();
    for (const row of rows) {
      if (additive && next.has(row)) next.delete(row);
      else next.add(row);
    }
    setSelectedRegions(next);
    const childIndices: number[] = [];
    for (const region of next) {
      const start = region * SITES_PER_REGION;
      for (let offset = 0; offset < SITES_PER_REGION; offset += 1) {
        childIndices.push(start + offset);
      }
    }
    syncingRef.current = true;
    engineRef.current?.selectIndices(childIndices, true);
    syncingRef.current = false;
    setSelectedSites(new Set(childIndices));
  };

  useEffect(() => {
    if (!mapRef.current) return;
    const engine = new FastPointEngine({
      target: mapRef.current,
      onSelectionChange: () => {
        if (syncingRef.current) return;
        setSelectedSites(new Set(engine.selectedIndices()));
        setSelectedRegions(new Set());
      },
    });
    engineRef.current = engine;
    const {dataset, summary} = createSampleDataset('100k sites', sites.records);
    engine.loadDataset(dataset, summary);
    engine.setPointStyle({
      radius: 3,
      selectedRadius: 6,
      selectedColor: packRgba(255, 255, 0),
    });
    engine.setCollapsePixels(1);
    engine.setEllipsesVisible(false);
    engine.setSelectedEllipsesVisible(false);
    engine.map.getView().setCenter(fromLonLat([-98.6, 39.8]));
    engine.map.getView().setZoom(4);

    const source = new VectorSource({
      features: REGION_SEEDS.map((seed, index) => {
        const feature = new Feature(new Point(fromLonLat([seed[3], seed[2]])));
        feature.set('regionIndex', index);
        return feature;
      }),
    });
    const layer = new VectorLayer({
      source,
      style: (feature) => {
        const selected = selectedRegionsRef.current.has(
          Number(feature.get('regionIndex'))
        );
        return new Style({
          image: new CircleStyle({
            radius: 12,
            fill: new Fill({color: selected ? 'yellow' : 'crimson'}),
            stroke: new Stroke({color: 'darkred', width: 2}),
          }),
        });
      },
    });
    layer.setZIndex(20);
    regionLayerRef.current = layer;
    engine.map.addLayer(layer);
    engine.map.on('singleclick', (event) => {
      const feature = engine.map.forEachFeatureAtPixel(
        event.pixel,
        (candidate) => candidate,
        {layerFilter: (candidate) => candidate === layer}
      );
      if (!feature) return;
      setParentSelection([Number(feature.get('regionIndex'))], false);
    });
    syncingRef.current = true;
    engine.selectIndices(
      Array.from({length: SITES_PER_REGION}, (_, index) => index),
      true
    );
    syncingRef.current = false;
    const observer = new ResizeObserver(() => engine.map.updateSize());
    observer.observe(mapRef.current);
    return () => {
      observer.disconnect();
      engine.dispose();
    };
  }, [sites]);

  useEffect(() => {
    regionLayerRef.current?.changed();
  }, [selectedRegions]);

  const selectSites = (rows: readonly number[], additive: boolean): void => {
    const engine = engineRef.current;
    if (!engine) return;
    if (additive && rows.length === 1) engine.toggleIndex(rows[0]);
    else engine.selectIndices(rows, !additive);
    setSelectedSites(new Set(engine.selectedIndices()));
  };

  return (
    <div className="reference-example-window reference-linked-window">
      <p className="reference-link-info">
        <strong>Workflow:</strong> Selecting region(s) in Table 1 selects all
        corresponding sites in Table 2 and on the map. If you draw a subset
        selection on the map, only Table 2 is highlighted and Table 1 is
        cleared.
      </p>
      <main
        className="reference-linked-layout"
        ref={layoutRef}
        style={{
          gridTemplateRows: `minmax(240px, ${mapPercent}%) 6px minmax(180px, 1fr)`,
        }}
      >
        <div className="reference-map-fill" ref={mapRef} />
        <RowSeparator
          containerRef={layoutRef}
          percent={mapPercent}
          setPercent={setMapPercent}
        />
        <section className="reference-tabs">
          <div className="reference-tab-buttons">
            <button
              type="button"
              className={tab === 'regions' ? 'is-active' : ''}
              onClick={() => setTab('regions')}
            >
              Table 1: Regions (multi-select)
            </button>
            <button
              type="button"
              className={tab === 'sites' ? 'is-active' : ''}
              onClick={() => setTab('sites')}
            >
              Table 2: Sites (all visible, multi-select)
            </button>
          </div>
          {tab === 'regions' ? (
            <VirtualGrid
              count={REGION_SEEDS.length}
              columns="1fr 1fr 1fr 0.7fr"
              headings={['Region', 'Region ID', 'Category', 'Sites']}
              rowKey={(row) => row}
              cells={(row) => [
                REGION_SEEDS[row][0],
                `region_${row}`,
                REGION_SEEDS[row][1],
                SITES_PER_REGION.toLocaleString(),
              ]}
              sortValues={[
                (row) => REGION_SEEDS[row][0],
                (row) => row,
                (row) => REGION_SEEDS[row][1],
                () => SITES_PER_REGION,
              ]}
              selected={selectedRegions}
              onSelection={setParentSelection}
            />
          ) : (
            <VirtualGrid
              count={sites.records.length}
              columns="1.2fr 1fr 0.8fr 0.5fr"
              headings={['Site', 'Site ID', 'Region', 'Score']}
              rowKey={(row) => row}
              cells={(row) => {
                const region = Math.floor(row / SITES_PER_REGION);
                const local = row % SITES_PER_REGION;
                return [
                  `${REGION_SEEDS[region][0]} Site ${local + 1}`,
                  `site_${region}_${local}`,
                  REGION_SEEDS[region][0],
                  sites.scores[row],
                ];
              }}
              sortValues={[
                (row) => row,
                (row) => row,
                (row) => Math.floor(row / SITES_PER_REGION),
                (row) => sites.scores[row],
              ]}
              selected={selectedSites}
              onSelection={selectSites}
            />
          )}
        </section>
      </main>
    </div>
  );
}

type ParentData = {
  records: {
    longitude: number;
    latitude: number;
    semiMajor: number;
    semiMinor: number;
    tilt: number;
    color: number;
  }[];
  region: Uint8Array;
  metaStart: Uint32Array;
  metaScore: Uint8Array;
};

function buildParentsAndMetadata(): ParentData {
  const generator = createSeededRandomGenerator(17);
  const random = generator.random;
  const records: ParentData['records'] = [];
  const region = new Uint8Array(100_000);
  const metaStart = new Uint32Array(100_001);
  const scores: number[] = [];
  let global = 0;
  for (
    let regionIndex = 0;
    regionIndex < REGION_SEEDS.length;
    regionIndex += 1
  ) {
    const seed = REGION_SEEDS[regionIndex];
    const localCount = 10_000;
    const latitudes = new Float64Array(localCount);
    const longitudes = new Float64Array(localCount);
    for (let index = 0; index < localCount; index += 1) {
      latitudes[index] = seed[2] + (random() - 0.5) * 2.1;
    }
    for (let index = 0; index < localCount; index += 1) {
      longitudes[index] = seed[3] + (random() - 0.5) * 2.5;
    }
    const major = Array.from({length: localCount}, () => 20 + random() * 160);
    const minor = Array.from({length: localCount}, () => 10 + random() * 110);
    const tilt = Array.from({length: localCount}, () => random() * 180);
    for (let local = 0; local < localCount; local += 1) {
      const metaCount = generator.integer(3, 6);
      records.push({
        latitude: latitudes[local],
        longitude: longitudes[local],
        semiMajor: major[local],
        semiMinor: minor[local],
        tilt: tilt[local],
        color: packRgba(0, 191, 255),
      });
      region[global] = regionIndex;
      metaStart[global] = scores.length;
      for (let child = 0; child < metaCount; child += 1) {
        scores.push(generator.integer(50, 100));
      }
      global += 1;
    }
  }
  metaStart[global] = scores.length;
  return {
    records,
    region,
    metaStart,
    metaScore: Uint8Array.from(scores),
  };
}

function metadataParent(metaStart: Uint32Array, row: number): number {
  let low = 0;
  let high = metaStart.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (metaStart[middle] <= row) low = middle;
    else high = middle;
  }
  return low;
}

/** Source-matched port of examples/16_metadata_only_table_linking.py. */
export function MetadataOnlyLinkingExampleApp() {
  const mapRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const engineRef = useRef<FastPointEngine | null>(null);
  const syncingRef = useRef(false);
  const data = useMemo(buildParentsAndMetadata, []);
  const [tab, setTab] = useState<'parents' | 'metadata'>('parents');
  const [selectedParents, setSelectedParents] = useState<Set<number>>(
    new Set([0, 1, 2, 3, 4])
  );
  const [selectedMetadata, setSelectedMetadata] = useState<Set<number>>(() => {
    const selected = new Set<number>();
    for (let parent = 0; parent < 5; parent += 1) {
      for (
        let row = data.metaStart[parent];
        row < data.metaStart[parent + 1];
        row += 1
      )
        selected.add(row);
    }
    return selected;
  });
  const [mapPercent, setMapPercent] = useState(66.67);

  const fanOutMetadata = (parents: ReadonlySet<number>): Set<number> => {
    const output = new Set<number>();
    for (const parent of parents) {
      for (
        let row = data.metaStart[parent];
        row < data.metaStart[parent + 1];
        row += 1
      )
        output.add(row);
    }
    return output;
  };

  useEffect(() => {
    if (!mapRef.current) return;
    const engine = new FastPointEngine({
      target: mapRef.current,
      onSelectionChange: () => {
        if (syncingRef.current) return;
        const parents = new Set(engine.selectedIndices());
        setSelectedParents(parents);
        setSelectedMetadata(fanOutMetadata(parents));
      },
    });
    engineRef.current = engine;
    const {dataset, summary} = createSampleDataset(
      '100k parent geos',
      data.records
    );
    engine.loadDataset(dataset, summary);
    engine.setPointStyle({
      radius: 2.5,
      selectedRadius: 5.5,
      selectedColor: packRgba(255, 255, 0),
    });
    engine.setCollapsePixels(2.5);
    engine.setEllipseStyle({
      ellipseWidth: 1,
      ellipseFillAlpha: 0,
      ellipseColor: packRgba(255, 165, 0),
      selectedEllipseColor: null,
      minEllipsePixels: 2,
    });
    engine.map.getView().setCenter(fromLonLat([-98.6, 39.8]));
    engine.map.getView().setZoom(4);
    syncingRef.current = true;
    engine.selectIndices([0, 1, 2, 3, 4], true);
    syncingRef.current = false;
    const observer = new ResizeObserver(() => engine.map.updateSize());
    observer.observe(mapRef.current);
    return () => {
      observer.disconnect();
      engine.dispose();
    };
  }, [data]);

  const selectParents = (rows: readonly number[], additive: boolean): void => {
    const engine = engineRef.current;
    if (!engine) return;
    if (additive && rows.length === 1) engine.toggleIndex(rows[0]);
    else engine.selectIndices(rows, !additive);
    const parents = new Set(engine.selectedIndices());
    setSelectedParents(parents);
    setSelectedMetadata(fanOutMetadata(parents));
  };

  const selectMetadata = (rows: readonly number[], additive: boolean): void => {
    setSelectedMetadata((current) => {
      const next = additive ? new Set(current) : new Set<number>();
      for (const row of rows) {
        if (additive && next.has(row)) next.delete(row);
        else next.add(row);
      }
      return next;
    });
    // MultiSelectLink(clear_parent_on_kid_subset=True) clears the parent/map
    // selection when a metadata-only child subset is chosen directly.
    syncingRef.current = true;
    engineRef.current?.clearSelection();
    syncingRef.current = false;
    setSelectedParents(new Set());
  };

  return (
    <div className="reference-example-window reference-linked-window">
      <p className="reference-link-info">
        <strong>Workflow:</strong> Table 1 is 100k FastGeo map objects. Table 2
        is metadata-only with 3-5 rows per geo (no map features). Selecting
        parent geos fans out selection to their metadata rows.
      </p>
      <main
        className="reference-linked-layout"
        ref={layoutRef}
        style={{
          gridTemplateRows: `minmax(240px, ${mapPercent}%) 6px minmax(180px, 1fr)`,
        }}
      >
        <div className="reference-map-fill" ref={mapRef} />
        <RowSeparator
          containerRef={layoutRef}
          percent={mapPercent}
          setPercent={setMapPercent}
        />
        <section className="reference-tabs">
          <div className="reference-tab-buttons">
            <button
              type="button"
              className={tab === 'parents' ? 'is-active' : ''}
              onClick={() => setTab('parents')}
            >
              Table 1: Parent geos (100k)
            </button>
            <button
              type="button"
              className={tab === 'metadata' ? 'is-active' : ''}
              onClick={() => setTab('metadata')}
            >
              Table 2: Metadata rows (no map geometry)
            </button>
          </div>
          {tab === 'parents' ? (
            <VirtualGrid
              count={data.records.length}
              columns="0.8fr 0.7fr 0.8fr 0.8fr 0.6fr"
              headings={['Geo ID', 'Region', 'Lat', 'Lon', 'Meta Rows']}
              rowKey={(row) => row}
              cells={(row) => [
                `geo_${row}`,
                REGION_SEEDS[data.region[row]][0],
                data.records[row].latitude.toFixed(5),
                data.records[row].longitude.toFixed(5),
                data.metaStart[row + 1] - data.metaStart[row],
              ]}
              sortValues={[
                (row) => row,
                (row) => data.region[row],
                (row) => data.records[row].latitude,
                (row) => data.records[row].longitude,
                (row) => data.metaStart[row + 1] - data.metaStart[row],
              ]}
              selected={selectedParents}
              onSelection={selectParents}
            />
          ) : (
            <VirtualGrid
              count={data.metaScore.length}
              columns="1.3fr 0.8fr 0.8fr 0.8fr 0.5fr 0.6fr"
              headings={[
                'Meta ID',
                'Geo ID',
                'Type',
                'Status',
                'Score',
                'Owner',
              ]}
              rowKey={(row) => row}
              cells={(row) => {
                const parent = metadataParent(data.metaStart, row);
                const local = row - data.metaStart[parent];
                const region = data.region[parent];
                return [
                  `meta_geo_${parent}_${local}`,
                  `geo_${parent}`,
                  ['inspection', 'permit', 'ticket', 'asset'][local % 4],
                  ['open', 'in_progress', 'closed'][(region + local) % 3],
                  data.metaScore[row],
                  `Team ${(region % 6) + 1}`,
                ];
              }}
              sortValues={[
                (row) => row,
                (row) => metadataParent(data.metaStart, row),
                (row) => {
                  const parent = metadataParent(data.metaStart, row);
                  return (row - data.metaStart[parent]) % 4;
                },
                (row) => {
                  const parent = metadataParent(data.metaStart, row);
                  return (
                    (data.region[parent] + row - data.metaStart[parent]) % 3
                  );
                },
                (row) => data.metaScore[row],
                (row) => {
                  const parent = metadataParent(data.metaStart, row);
                  return data.region[parent] % 6;
                },
              ]}
              selected={selectedMetadata}
              onSelection={selectMetadata}
            />
          )}
        </section>
      </main>
    </div>
  );
}
