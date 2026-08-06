import {useEffect, useRef} from 'react';
import Feature from 'ol/Feature.js';
import type {FeatureLike} from 'ol/Feature.js';
import GeometryCollection from 'ol/geom/GeometryCollection.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import Select from 'ol/interaction/Select.js';
import {platformModifierKeyOnly, singleClick} from 'ol/events/condition.js';
import VectorLayer from 'ol/layer/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {fromLonLat} from 'ol/proj.js';
import OSM from 'ol/source/OSM.js';
import VectorSource from 'ol/source/Vector.js';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style.js';
import {gradientColor} from '../lib/colorPalettes';
import {
  expandGradientCoordinates,
  expandSegmentColors,
  renderedGradientValues,
} from '../lib/gradientLine';
import {installReferenceCoordinateDisplay} from '../map/referenceCoordinateDisplay';

type Coordinate = readonly [number, number];

const BASE_TRACK: readonly Coordinate[] = [
  [37.8078, -122.4177],
  [37.8034, -122.4109],
  [37.7986, -122.4072],
  [37.7924, -122.4019],
  [37.7873, -122.4052],
  [37.7831, -122.409],
  [37.7791, -122.4148],
  [37.775, -122.4195],
  [37.771, -122.4234],
  [37.768, -122.426],
];

function offsetTrack(
  coordinates: readonly Coordinate[],
  latitudeOffset = 0,
  longitudeOffset = 0
): Coordinate[] {
  return coordinates.map(([latitude, longitude]) => [
    latitude + latitudeOffset,
    longitude + longitudeOffset,
  ]);
}

function cssColor(value: number, alpha = 217): string {
  const color = gradientColor(value, 'turbo', alpha);
  return `rgba(${(color >>> 24) & 255}, ${(color >>> 16) & 255}, ${(color >>> 8) & 255}, ${(color & 255) / 255})`;
}

function gradientColors(
  values: readonly number[],
  minimum = Math.min(...values),
  maximum = Math.max(...values)
): string[] {
  const span = maximum - minimum;
  return values.map((value) =>
    cssColor(span > 0 ? (value - minimum) / span : 0)
  );
}

function trackFeature(
  id: string,
  coordinates: readonly Coordinate[],
  colors: readonly string[]
): Feature {
  const segments = coordinates
    .slice(1)
    .map(
      (coordinate, index) =>
        new LineString([
          fromLonLat([coordinates[index][1], coordinates[index][0]]),
          fromLonLat([coordinate[1], coordinate[0]]),
        ])
    );
  const feature = new Feature(new GeometryCollection(segments));
  feature.setId(id);
  feature.setProperties({kind: 'track', colors});
  return feature;
}

function trackStyles(feature: FeatureLike): Style | Style[] {
  if (feature.get('kind') !== 'track') {
    return new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({color: 'white'}),
        stroke: new Stroke({color: 'black', width: 1.2}),
      }),
    });
  }
  const geometry = feature.getGeometry() as GeometryCollection;
  const colors = feature.get('colors') as string[];
  return geometry.getGeometries().map(
    (segment, index) =>
      new Style({
        geometry: segment,
        stroke: new Stroke({color: colors[index], width: 6}),
      })
  );
}

function selectedTrackStyle(feature: FeatureLike): Style {
  if (feature.get('kind') === 'track') {
    return new Style({
      stroke: new Stroke({color: '#00ffff', width: 8}),
    });
  }
  return new Style({
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({color: '#00ffff'}),
      stroke: new Stroke({color: '#004c66', width: 2}),
    }),
  });
}

function buildFeatures(): Feature[] {
  const interpolateSteps = 96;
  const segmentTrack = offsetTrack(BASE_TRACK, 0.0018);
  const segmentValues = [12, 18, 24, 28, 20, 14, 10, 16, 22];
  const segmentRenderedValues = renderedGradientValues(
    segmentValues,
    segmentTrack.length,
    interpolateSteps
  );
  const expandedSegmentTrack = expandGradientCoordinates(
    segmentTrack,
    interpolateSteps
  );

  const vertexTrack = offsetTrack(BASE_TRACK, -0.0018);
  const vertexValues = [10, 14, 18, 24, 30, 26, 20, 14, 12, 9];
  const vertexRenderedValues = renderedGradientValues(
    vertexValues,
    vertexTrack.length,
    interpolateSteps
  );
  const expandedVertexTrack = expandGradientCoordinates(
    vertexTrack,
    interpolateSteps
  );

  const explicitTrack = offsetTrack(BASE_TRACK, 0, -0.006);
  const explicitColors = [
    '#2b83bad9',
    '#2b83bad9',
    '#abdda4d9',
    '#ffffbfd9',
    '#fdae61d9',
    '#f46d43d9',
    '#d7191cd9',
    '#f46d43d9',
    '#abdda4d9',
  ];
  const expandedExplicitTrack = expandGradientCoordinates(
    explicitTrack,
    interpolateSteps
  );
  const features = [
    trackFeature(
      'track_segment_values',
      expandedSegmentTrack,
      gradientColors(segmentRenderedValues)
    ),
    trackFeature(
      'track_vertex_values',
      expandedVertexTrack,
      gradientColors(vertexRenderedValues, 0, 35)
    ),
    trackFeature(
      'track_explicit_colors',
      expandedExplicitTrack,
      expandSegmentColors(explicitColors, interpolateSteps)
    ),
  ];
  [
    [segmentTrack[0], 'seg_start'],
    [segmentTrack.at(-1)!, 'seg_end'],
    [vertexTrack[0], 'vertex_start'],
    [explicitTrack[0], 'explicit_start'],
  ].forEach(([coordinate, id]) => {
    const [latitude, longitude] = coordinate as Coordinate;
    const point = new Feature(new Point(fromLonLat([longitude, latitude])));
    point.setId(String(id));
    point.set('kind', 'endpoint');
    features.push(point);
  });
  return features;
}

/** Browser port of examples/18_gradient_track_speed.py. */
export function GradientTracksExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapTargetRef.current) return;
    document.title = 'Gradient Track Speed Example (All Use Cases)';
    const layer = new VectorLayer({
      source: new VectorSource({features: buildFeatures()}),
      style: trackStyles,
    });
    const map = new Map({
      target: mapTargetRef.current,
      layers: [new TileLayer({source: new OSM({transition: 0})}), layer],
      view: new View({
        center: fromLonLat([-122.4241, 37.7795]),
        zoom: 13,
      }),
    });
    const coordinates = installReferenceCoordinateDisplay(
      map,
      mapTargetRef.current
    );
    map.addInteraction(
      new Select({
        layers: [layer],
        condition: singleClick,
        toggleCondition: platformModifierKeyOnly,
        multi: true,
        style: selectedTrackStyle,
      })
    );
    return () => {
      coordinates.dispose();
      map.setTarget(undefined);
    };
  }, []);

  return (
    <main className="reference-example-window">
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  );
}
