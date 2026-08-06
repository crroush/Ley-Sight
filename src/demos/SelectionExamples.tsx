import {useEffect, useMemo, useRef, useState} from 'react';
import Feature from 'ol/Feature.js';
import type {FeatureLike} from 'ol/Feature.js';
import GeometryCollection from 'ol/geom/GeometryCollection.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import DragBox from 'ol/interaction/DragBox.js';
import Select from 'ol/interaction/Select.js';
import VectorLayer from 'ol/layer/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {platformModifierKeyOnly, singleClick} from 'ol/events/condition.js';
import {fromLonLat} from 'ol/proj.js';
import OSM from 'ol/source/OSM.js';
import VectorSource from 'ol/source/Vector.js';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style.js';
import {gradientColor} from '../lib/colorPalettes';
import {
  expandGradientCoordinates,
  renderedGradientValues,
} from '../lib/gradientLine';
import {installReferenceCoordinateDisplay} from '../map/referenceCoordinateDisplay';
import {
  createEllipsePolygon,
  createReferenceRandom,
  createReferenceRandomGenerator,
} from './referenceData';

function selectedGeometryStyle(feature: FeatureLike): Style | Style[] {
  const kind = String(feature.get('kind'));
  const geometry = feature.getGeometry();
  if (kind === 'geo') {
    const geometries = (geometry as GeometryCollection).getGeometries();
    return [
      new Style({
        geometry: geometries[1],
        fill: new Fill({color: 'rgba(255, 165, 0, 0.16)'}),
        stroke: new Stroke({color: 'orange', width: 2}),
      }),
      new Style({
        geometry: geometries[0],
        image: new CircleStyle({
          radius: 8,
          fill: new Fill({color: 'orange'}),
          stroke: new Stroke({color: '#00ffff', width: 2}),
        }),
      }),
    ];
  }
  if (kind === 'track') {
    return new Style({
      stroke: new Stroke({color: '#00ffff', width: 9}),
    });
  }
  return new Style({
    image: new CircleStyle({
      radius: kind === 'vector' ? 12 : 7,
      fill: new Fill({color: kind === 'fast' ? 'yellow' : '#00ffff'}),
      stroke: new Stroke({color: '#00ffff', width: 2}),
    }),
  });
}

function installBoxSelection(
  map: Map,
  select: Select,
  sources: readonly VectorSource[]
): () => void {
  const dragBox = new DragBox({condition: platformModifierKeyOnly});
  map.addInteraction(dragBox);
  const onBoxEnd = (): void => {
    const selected = select.getFeatures();
    const known = new Set(selected.getArray());
    const extent = dragBox.getGeometry().getExtent();
    for (const source of sources) {
      for (const feature of source.getFeaturesInExtent(extent)) {
        if (known.has(feature)) continue;
        known.add(feature);
        selected.push(feature);
      }
    }
    select.dispatchEvent('select');
  };
  dragBox.on('boxend', onBoxEnd);
  return () => dragBox.un('boxend', onBoxEnd);
}

function pointFeature(
  latitude: number,
  longitude: number,
  id: string,
  kind: 'vector' | 'fast',
  color: string
): Feature {
  const feature = new Feature(new Point(fromLonLat([longitude, latitude])));
  feature.setId(id);
  feature.setProperties({kind, layerName: `${kind}_points`, color});
  return feature;
}

function geoFeature(
  latitude: number,
  longitude: number,
  id: string,
  semiMajor: number,
  semiMinor: number,
  tilt: number,
  color = 'steelblue'
): Feature {
  const feature = new Feature(
    new GeometryCollection([
      new Point(fromLonLat([longitude, latitude])),
      createEllipsePolygon(latitude, longitude, semiMajor, semiMinor, tilt),
    ])
  );
  feature.setId(id);
  feature.setProperties({kind: 'geo', layerName: 'geo_points', color});
  return feature;
}

function normalStyle(feature: FeatureLike): Style | Style[] {
  const kind = String(feature.get('kind'));
  const color = String(feature.get('color') ?? 'steelblue');
  if (kind === 'geo') {
    const geometries = (
      feature.getGeometry() as GeometryCollection
    ).getGeometries();
    return [
      new Style({
        geometry: geometries[1],
        fill: new Fill({color: 'rgba(70, 130, 180, 0.16)'}),
        stroke: new Stroke({color, width: 1}),
      }),
      new Style({
        geometry: geometries[0],
        image: new CircleStyle({
          radius: Number(feature.get('radius') ?? 5),
          fill: new Fill({color}),
        }),
      }),
    ];
  }
  return new Style({
    image: new CircleStyle({
      radius:
        kind === 'vector'
          ? Number(feature.get('radius') ?? 10)
          : Number(feature.get('radius') ?? 4),
      fill: new Fill({color}),
      stroke:
        kind === 'vector'
          ? new Stroke({color: 'darkred', width: 2})
          : undefined,
    }),
  });
}

function selectionSample() {
  const vectorSource = new VectorSource({
    features: [
      pointFeature(37.7749, -122.4194, 'vector_0', 'vector', 'crimson'),
      pointFeature(37.8044, -122.2712, 'vector_1', 'vector', 'crimson'),
      pointFeature(37.3382, -121.8863, 'vector_2', 'vector', 'crimson'),
    ],
  });
  const fastGenerator = createReferenceRandomGenerator(42);
  const fastRandom = fastGenerator.random;
  const fastLatitudes = Array.from(
    {length: 100},
    () => 37.5 + fastRandom() * 0.5
  );
  const fastLongitudes = Array.from(
    {length: 100},
    () => -122.7 + fastRandom() * 0.5
  );
  const fastSource = new VectorSource({
    features: Array.from({length: 100}, (_, index) =>
      pointFeature(
        fastLatitudes[index],
        fastLongitudes[index],
        `fast_${index}`,
        'fast',
        'green'
      )
    ),
  });
  const geoRandom = createReferenceRandom(43);
  const geoLatitudes = Array.from({length: 30}, () => 37.6 + geoRandom() * 0.4);
  const geoLongitudes = Array.from(
    {length: 30},
    () => -122.6 + geoRandom() * 0.4
  );
  const geoCoordinates = geoLatitudes.map((latitude, index) => ({
    latitude,
    longitude: geoLongitudes[index],
  }));
  const major = geoCoordinates.map(() => 100 + geoRandom() * 400);
  const minor = geoCoordinates.map(() => 50 + geoRandom() * 200);
  const tilt = geoCoordinates.map(() => geoRandom() * 360);
  const geoSource = new VectorSource({
    features: geoCoordinates.map((coordinate, index) =>
      geoFeature(
        coordinate.latitude,
        coordinate.longitude,
        `geo_${index}`,
        major[index],
        minor[index],
        tilt[index]
      )
    ),
  });
  return {vectorSource, fastSource, geoSource};
}

/** Browser port of examples/07_feature_selection.py. */
export function FeatureSelectionExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const sample = useMemo(selectionSample, []);
  const [selectionText, setSelectionText] = useState('No selection');

  useEffect(() => {
    if (!mapTargetRef.current) return;
    document.title = 'Feature Selection Across Multiple Layers';
    const sources = [sample.vectorSource, sample.fastSource, sample.geoSource];
    const layers = sources.map(
      (source) => new VectorLayer({source, style: normalStyle})
    );
    const map = new Map({
      target: mapTargetRef.current,
      layers: [new TileLayer({source: new OSM({transition: 0})}), ...layers],
      view: new View({
        center: fromLonLat([-122.4194, 37.7749]),
        zoom: 10,
      }),
    });
    const coordinates = installReferenceCoordinateDisplay(
      map,
      mapTargetRef.current
    );
    const select = new Select({
      layers,
      condition: singleClick,
      toggleCondition: platformModifierKeyOnly,
      multi: true,
      style: selectedGeometryStyle,
    });
    const updateLabel = (): void => {
      const breakdown = new globalThis.Map<string, number>();
      for (const feature of select.getFeatures().getArray()) {
        const layer = String(feature.get('layerName'));
        breakdown.set(layer, (breakdown.get(layer) ?? 0) + 1);
      }
      const total = select.getFeatures().getLength();
      if (!total) {
        setSelectionText('No selection');
        return;
      }
      setSelectionText(
        `Selected ${total} feature(s): ${Array.from(
          breakdown,
          ([layer, count]) => `${layer.split('_')[0]}: ${count}`
        ).join(', ')}`
      );
    };
    select.on('select', updateLabel);
    map.addInteraction(select);
    const removeBox = installBoxSelection(map, select, sources);
    return () => {
      coordinates.dispose();
      removeBox();
      map.setTarget(undefined);
    };
  }, [sample]);

  return (
    <main className="reference-example-window">
      <section className="reference-instruction-panel">
        <p>
          Selection Instructions:
          <br />
          • Click on any point to select it
          <br />
          • Ctrl/Cmd+Click to add to selection (multi-select)
          <br />
          • Ctrl/Cmd+Drag to box select multiple points
          <br />• Click on empty area to clear selection
        </p>
        <strong>{selectionText}</strong>
      </section>
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  );
}

const RECOLOR_BUTTONS = [
  ['Red', 'red'],
  ['Green', 'green'],
  ['Blue', 'blue'],
  ['Yellow', 'yellow'],
  ['Purple', 'purple'],
  ['Orange', 'orange'],
  ['Pink', 'pink'],
  ['Cyan', 'cyan'],
] as const;

const REFERENCE_NAMED_RGB: Readonly<
  Record<string, readonly [number, number, number]>
> = {
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  purple: [128, 0, 128],
  orange: [255, 165, 0],
  pink: [255, 192, 203],
  cyan: [0, 255, 255],
};

function referenceNamedColorWithOpacity(
  color: string,
  opacity: number
): string {
  const [red, green, blue] = REFERENCE_NAMED_RGB[color] ?? [0, 0, 0];
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function packedCss(color: number): string {
  return `rgba(${(color >>> 24) & 255}, ${(color >>> 16) & 255}, ${(color >>> 8) & 255}, ${(color & 255) / 255})`;
}

function turboCss(value: number): string {
  return packedCss(gradientColor(value, 'turbo', 204));
}

function recolorSample() {
  const vectorFeatures = [
    [37.7749, -122.4194, 'red'],
    [37.7844, -122.4078, 'blue'],
    [37.7694, -122.4362, 'green'],
    [37.7599, -122.4148, 'purple'],
    [37.7899, -122.4294, 'orange'],
  ].map(([latitude, longitude, color]) => {
    const feature = pointFeature(
      Number(latitude),
      Number(longitude),
      `vec_${color}`,
      'vector',
      String(color)
    );
    feature.set('radius', 12);
    return feature;
  });
  const trackCoordinates: readonly (readonly [number, number])[] = [
    [37.8078, -122.4177],
    [37.8034, -122.4109],
    [37.7986, -122.4072],
    [37.7924, -122.4019],
    [37.7873, -122.4052],
    [37.7831, -122.409],
    [37.7791, -122.4148],
    [37.775, -122.4195],
  ];
  const segmentSpeeds = [12, 18, 24, 28, 20, 14, 10];
  const interpolateSteps = 96;
  const expandedTrackCoordinates = expandGradientCoordinates(
    trackCoordinates,
    interpolateSteps
  );
  const renderedSpeeds = renderedGradientValues(
    segmentSpeeds,
    trackCoordinates.length,
    interpolateSteps
  );
  const track = new Feature(
    new GeometryCollection(
      expandedTrackCoordinates
        .slice(1)
        .map(
          (coordinate, index) =>
            new LineString([
              fromLonLat([
                expandedTrackCoordinates[index][1],
                expandedTrackCoordinates[index][0],
              ]),
              fromLonLat([coordinate[1], coordinate[0]]),
            ])
        )
    )
  );
  track.setId('track_speed');
  track.setProperties({
    kind: 'track',
    layerName: 'vector_points',
    values: renderedSpeeds,
  });
  vectorFeatures.push(track);
  const vectorSource = new VectorSource({features: vectorFeatures});

  const fastGenerator = createReferenceRandomGenerator(42);
  const fastRandom = fastGenerator.random;
  const fastLatitudes = Array.from(
    {length: 100},
    () => 37.72 + fastRandom() * 0.12
  );
  const fastLongitudes = Array.from(
    {length: 100},
    () => -122.5 + fastRandom() * 0.15
  );
  const fastCoordinates = fastLatitudes.map((latitude, index) => ({
    latitude,
    longitude: fastLongitudes[index],
  }));
  const fastSource = new VectorSource({
    features: fastCoordinates.map((coordinate, index) => {
      const feature = pointFeature(
        coordinate.latitude,
        coordinate.longitude,
        `fast_${index}`,
        'fast',
        `rgba(${fastGenerator.integer(50, 255)}, ${fastGenerator.integer(50, 255)}, ${fastGenerator.integer(50, 255)}, ${200 / 255})`
      );
      feature.set('radius', 5);
      return feature;
    }),
  });

  const geoGenerator = createReferenceRandomGenerator(43);
  const geoRandom = geoGenerator.random;
  const geoLatitudes = Array.from(
    {length: 50},
    () => 37.74 + geoRandom() * 0.08
  );
  const geoLongitudes = Array.from(
    {length: 50},
    () => -122.48 + geoRandom() * 0.1
  );
  const geoCoordinates = geoLatitudes.map((latitude, index) => ({
    latitude,
    longitude: geoLongitudes[index],
  }));
  const major = geoCoordinates.map(() => 100 + geoRandom() * 300);
  const minor = geoCoordinates.map(() => 50 + geoRandom() * 150);
  const tilt = geoCoordinates.map(() => geoRandom() * 360);
  const geoSource = new VectorSource({
    features: geoCoordinates.map((coordinate, index) => {
      const feature = geoFeature(
        coordinate.latitude,
        coordinate.longitude,
        `geo_${index}`,
        major[index],
        minor[index],
        tilt[index],
        `rgba(${geoGenerator.integer(50, 255)}, ${geoGenerator.integer(50, 255)}, ${geoGenerator.integer(50, 255)}, ${200 / 255})`
      );
      feature.set('radius', 6);
      return feature;
    }),
  });
  return {vectorSource, fastSource, geoSource};
}

function recolorStyle(feature: FeatureLike): Style | Style[] {
  if (feature.get('kind') !== 'track') return normalStyle(feature);
  const geometry = feature.getGeometry() as GeometryCollection;
  const override = feature.get('colorOverride');
  const values = feature.get('values') as number[];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return geometry.getGeometries().map(
    (segment, index) =>
      new Style({
        geometry: segment,
        stroke: new Stroke({
          color: override
            ? String(override)
            : turboCss((values[index] - minimum) / (maximum - minimum)),
          width: 7,
        }),
      })
  );
}

/** Browser port of examples/09_selection_and_recoloring.py. */
export function SelectionRecolorExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<Select | null>(null);
  const layersRef = useRef<VectorLayer<VectorSource>[]>([]);
  const sample = useMemo(recolorSample, []);
  const [selectionText, setSelectionText] = useState(
    'No selection - click on points to select them'
  );

  useEffect(() => {
    if (!mapTargetRef.current) return;
    document.title = 'Selection and Interactive Recoloring';
    const sources = [sample.vectorSource, sample.fastSource, sample.geoSource];
    const layers = sources.map(
      (source) => new VectorLayer({source, style: recolorStyle})
    );
    layersRef.current = layers;
    const map = new Map({
      target: mapTargetRef.current,
      layers: [new TileLayer({source: new OSM({transition: 0})}), ...layers],
      view: new View({
        center: fromLonLat([-122.4194, 37.7749]),
        zoom: 10,
      }),
    });
    const coordinates = installReferenceCoordinateDisplay(
      map,
      mapTargetRef.current
    );
    const select = new Select({
      layers,
      condition: singleClick,
      toggleCondition: platformModifierKeyOnly,
      multi: true,
      style: selectedGeometryStyle,
    });
    select.on('select', () => {
      const count = select.getFeatures().getLength();
      setSelectionText(
        count
          ? `Selected ${count} feature(s)`
          : 'No selection - click on points to select them'
      );
    });
    map.addInteraction(select);
    selectRef.current = select;
    const removeBox = installBoxSelection(map, select, sources);
    return () => {
      coordinates.dispose();
      removeBox();
      selectRef.current = null;
      layersRef.current = [];
      map.setTarget(undefined);
    };
  }, [sample]);

  const recolor = (color: string): void => {
    const selected = selectRef.current?.getFeatures().getArray() ?? [];
    if (!selected.length) {
      window.alert('Please select some features first by clicking on them.');
      return;
    }
    for (const feature of selected) {
      if (feature.get('kind') === 'track') {
        feature.set(
          'colorOverride',
          referenceNamedColorWithOpacity(color, 0.8)
        );
      } else {
        feature.set('color', color);
      }
    }
    for (const layer of layersRef.current) layer.changed();
  };

  return (
    <main className="reference-example-window">
      <section className="reference-recolor-controls">
        <strong>
          Select features (click or Ctrl+drag), including the gradient track,
          then click a color button to recolor them
        </strong>
        <div>
          {RECOLOR_BUTTONS.map(([name, color]) => (
            <button
              key={name}
              type="button"
              style={{backgroundColor: color}}
              onClick={() => recolor(color)}
            >
              {name}
            </button>
          ))}
        </div>
        <span>{selectionText}</span>
      </section>
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  );
}
