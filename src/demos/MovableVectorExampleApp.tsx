import {useEffect, useRef} from 'react';
import Collection from 'ol/Collection.js';
import Feature from 'ol/Feature.js';
import type {FeatureLike} from 'ol/Feature.js';
import CircleGeometry from 'ol/geom/Circle.js';
import GeometryCollection from 'ol/geom/GeometryCollection.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import Modify from 'ol/interaction/Modify.js';
import Select from 'ol/interaction/Select.js';
import {platformModifierKeyOnly, singleClick} from 'ol/events/condition.js';
import Translate from 'ol/interaction/Translate.js';
import VectorLayer from 'ol/layer/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {fromLonLat} from 'ol/proj.js';
import OSM from 'ol/source/OSM.js';
import VectorSource from 'ol/source/Vector.js';
import {
  Circle as CircleStyle,
  Fill,
  Icon,
  Stroke,
  Style,
  Text,
} from 'ol/style.js';
import {gradientColor} from '../lib/colorPalettes';
import {createEllipsePolygon} from './referenceData';

type VertexMode = 'move' | 'modify' | 'none';

function properties(
  label: string,
  movable: boolean,
  vertexMode: VertexMode = 'move'
) {
  return {label, movable, vertexMode};
}

function polygonFeature(
  coordinates: readonly [number, number][],
  id: string,
  color: string,
  label: string,
  movable: boolean,
  vertexMode: VertexMode
): Feature {
  const ring = coordinates.map(([latitude, longitude]) =>
    fromLonLat([longitude, latitude])
  );
  ring.push(ring[0]);
  const feature = new Feature(new Polygon([ring]));
  feature.setId(id);
  feature.setProperties({
    kind: 'polygon',
    color,
    ...properties(label, movable, vertexMode),
  });
  return feature;
}

function lineFeature(
  coordinates: readonly [number, number][],
  id: string,
  color: string,
  label: string,
  movable: boolean,
  vertexMode: VertexMode
): Feature {
  const feature = new Feature(
    new LineString(
      coordinates.map(([latitude, longitude]) =>
        fromLonLat([longitude, latitude])
      )
    )
  );
  feature.setId(id);
  feature.setProperties({
    kind: 'line',
    color,
    ...properties(label, movable, vertexMode),
  });
  return feature;
}

function gradientFeature(
  coordinates: readonly [number, number][],
  values: readonly number[],
  id: string,
  label: string,
  movable: boolean
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
  feature.setProperties({
    kind: 'gradient',
    values,
    ...properties(label, movable, 'none'),
  });
  return feature;
}

function createFeatures(): Feature[] {
  const red = '#d62728';
  const movablePoint = new Feature(new Point(fromLonLat([-122, 40.5])));
  movablePoint.setId('movable_point');
  movablePoint.setProperties({
    kind: 'point',
    color: '#1f77b4',
    ...properties('movable point', true),
  });
  const fixedPoint = new Feature(new Point(fromLonLat([-121, 38.7])));
  fixedPoint.setId('fixed_point');
  fixedPoint.setProperties({
    kind: 'point',
    color: '#1f77b4',
    ...properties('not movable point', false),
  });
  const movableIcon = new Feature(new Point(fromLonLat([-119.5, 37.8])));
  movableIcon.setId('movable_icon_point');
  movableIcon.setProperties({
    kind: 'icon',
    src: '/resources/orange_pin.svg',
    ...properties('movable icon point', true),
  });
  const fixedIcon = new Feature(new Point(fromLonLat([-118.3, 36.6])));
  fixedIcon.setId('fixed_icon_point');
  fixedIcon.setProperties({
    kind: 'icon',
    src:
      'data:image/svg+xml;utf8,' +
      "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'>" +
      "<path fill='%23d62728' stroke='black' d='M32 2C20 2 11 11 11 23c0 16 21 39 21 39s21-23 21-39C53 11 44 2 32 2z'/>" +
      "<circle cx='32' cy='23' r='8' fill='white'/></svg>",
    ...properties('not movable icon point', false),
  });
  const features: Feature[] = [
    movablePoint,
    fixedPoint,
    movableIcon,
    fixedIcon,
    lineFeature(
      [
        [45, -104],
        [44, -101],
        [45, -98],
      ],
      'move_vertices_line',
      'orange',
      'movable line',
      true,
      'move'
    ),
    lineFeature(
      [
        [42.5, -104],
        [41.5, -101],
        [42.5, -98],
      ],
      'modify_line',
      'purple',
      'movable line',
      true,
      'modify'
    ),
    lineFeature(
      [
        [40, -104],
        [39, -101],
        [40, -98],
      ],
      'fixed_line',
      red,
      'not movable line',
      false,
      'none'
    ),
    gradientFeature(
      [
        [36.8, -104],
        [36.2, -101.5],
        [36.8, -99],
      ],
      [0, 5, 10],
      'movable_gradient_line',
      'movable gradient line',
      true
    ),
    gradientFeature(
      [
        [35, -104],
        [34.4, -101.5],
        [35, -99],
      ],
      [10, 5, 0],
      'fixed_gradient_line',
      'not movable gradient line',
      false
    ),
    polygonFeature(
      [
        [45, -93],
        [44, -90],
        [42.5, -91.5],
        [43.2, -94],
      ],
      'move_vertices_polygon',
      'green',
      'movable polygon',
      true,
      'move'
    ),
    polygonFeature(
      [
        [41.5, -93],
        [40.5, -90],
        [39, -91.5],
        [39.8, -94],
      ],
      'modify_polygon',
      'olive',
      'movable polygon',
      true,
      'modify'
    ),
    polygonFeature(
      [
        [38, -93],
        [37, -90],
        [35.5, -91.5],
        [36.3, -94],
      ],
      'whole_polygon',
      'navy',
      'movable polygon',
      true,
      'none'
    ),
    polygonFeature(
      [
        [34.5, -93],
        [33.5, -90],
        [32, -91.5],
        [32.8, -94],
      ],
      'fixed_polygon',
      red,
      'not movable polygon',
      false,
      'none'
    ),
  ];
  const movableCircle = new Feature(
    new CircleGeometry(fromLonLat([-84, 42]), 90_000)
  );
  movableCircle.setId('movable_circle');
  movableCircle.setProperties({
    kind: 'circle',
    color: '#1f77b4',
    ...properties('movable circle', true, 'none'),
  });
  const fixedCircle = new Feature(
    new CircleGeometry(fromLonLat([-84, 39]), 90_000)
  );
  fixedCircle.setId('fixed_circle');
  fixedCircle.setProperties({
    kind: 'circle',
    color: red,
    ...properties('not movable circle', false, 'none'),
  });
  const movableEllipse = new Feature(
    createEllipsePolygon(42, -78, 150_000, 70_000, 35)
  );
  movableEllipse.setId('movable_ellipse');
  movableEllipse.setProperties({
    kind: 'ellipse',
    color: '#17becf',
    ...properties('movable ellipse', true),
  });
  const fixedEllipse = new Feature(
    createEllipsePolygon(39, -78, 150_000, 70_000, -25)
  );
  fixedEllipse.setId('fixed_ellipse');
  fixedEllipse.setProperties({
    kind: 'ellipse',
    color: red,
    ...properties('not movable ellipse', false),
  });
  features.push(movableCircle, fixedCircle, movableEllipse, fixedEllipse);
  return features;
}

function labelText(feature: FeatureLike): Text {
  return new Text({
    text: String(feature.get('label') ?? ''),
    font: '12px Arial',
    fill: new Fill({color: '#111'}),
    stroke: new Stroke({color: 'rgba(255,255,255,0.95)', width: 3}),
    offsetY: -14,
  });
}

function featureStyles(feature: FeatureLike): Style | Style[] {
  const kind = String(feature.get('kind'));
  const color = String(feature.get('color') ?? '#1f77b4');
  if (kind === 'icon') {
    return new Style({
      image: new Icon({
        src: String(feature.get('src')),
        scale: 0.8,
        anchor: [0.5, 1],
      }),
      text: labelText(feature),
    });
  }
  if (kind === 'point') {
    return new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({color}),
        stroke: new Stroke({color: '#111', width: 1}),
      }),
      text: labelText(feature),
    });
  }
  if (kind === 'gradient') {
    const geometries = (
      feature.getGeometry() as GeometryCollection
    ).getGeometries();
    const values = feature.get('values') as number[];
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    return geometries.map((geometry, index) => {
      const ratio =
        ((values[index] + values[index + 1]) / 2 - minimum) /
        Math.max(1, maximum - minimum);
      const packed = gradientColor(ratio, 'turbo', 255);
      return new Style({
        geometry,
        stroke: new Stroke({
          color: `rgb(${(packed >>> 24) & 255} ${(packed >>> 16) & 255} ${(packed >>> 8) & 255})`,
          width: 5,
        }),
        text: index === 0 ? labelText(feature) : undefined,
      });
    });
  }
  if (kind === 'line') {
    return new Style({
      stroke: new Stroke({color, width: 4}),
      text: labelText(feature),
    });
  }
  return new Style({
    fill: new Fill({
      color: color === '#d62728' ? 'rgba(214, 39, 40, 0.45)' : `${color}55`,
    }),
    stroke: new Stroke({color, width: 2}),
    text: labelText(feature),
  });
}

/** Browser port of examples/21_movable_vector_features.py. */
export function MovableVectorExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapTargetRef.current) return;
    document.title = 'Movable Vector Feature Demo';
    const source = new VectorSource({features: createFeatures()});
    const layer = new VectorLayer({source, style: featureStyles});
    const map = new Map({
      target: mapTargetRef.current,
      layers: [new TileLayer({source: new OSM({transition: 0})}), layer],
      view: new View({center: fromLonLat([-98, 39.5]), zoom: 4}),
    });
    const select = new Select({
      layers: [layer],
      condition: singleClick,
      toggleCondition: platformModifierKeyOnly,
      multi: true,
    });
    map.addInteraction(select);
    const moveVertices = new Collection<Feature>();
    const modifyVertices = new Collection<Feature>();
    const syncModifyCollections = (): void => {
      moveVertices.clear();
      modifyVertices.clear();
      for (const feature of select.getFeatures().getArray()) {
        if (!feature.get('movable')) continue;
        if (feature.get('vertexMode') === 'move') {
          moveVertices.push(feature as Feature);
        } else if (feature.get('vertexMode') === 'modify') {
          modifyVertices.push(feature as Feature);
        }
      }
    };
    select.on('select', syncModifyCollections);
    map.addInteraction(
      new Translate({
        features: select.getFeatures(),
        filter: (feature) => feature.get('movable') === true,
      })
    );
    map.addInteraction(
      new Modify({
        features: moveVertices,
        insertVertexCondition: () => false,
      })
    );
    map.addInteraction(new Modify({features: modifyVertices}));
    return () => map.setTarget(undefined);
  }, []);

  return (
    <main className="reference-example-window">
      <section className="reference-movable-instructions">
        <strong>Movable Vector Feature Demo</strong>
        <span>
          • Every vector feature type appears as movable and not movable.
        </span>
        <span>• Feature labels only say whether the object is movable.</span>
        <span>• Orange line and green polygon: existing vertices move.</span>
        <span>
          • Purple line and olive polygon: new vertices can be created.
        </span>
        <span>
          • Navy polygon and gradient line: whole-object movement only.
        </span>
        <span>
          • Red objects, including the red icon point, are not movable and
          should stay fixed.
        </span>
      </section>
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  );
}
