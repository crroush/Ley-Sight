import {useEffect, useRef} from 'react';
import Feature from 'ol/Feature.js';
import type {FeatureLike} from 'ol/Feature.js';
import CircleGeometry from 'ol/geom/Circle.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import Select from 'ol/interaction/Select.js';
import {platformModifierKeyOnly, singleClick} from 'ol/events/condition.js';
import VectorLayer from 'ol/layer/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {fromLonLat} from 'ol/proj.js';
import OSM from 'ol/source/OSM.js';
import VectorSource from 'ol/source/Vector.js';
import {Circle as CircleStyle, Fill, Icon, Stroke, Style} from 'ol/style.js';
import {createEllipsePolygon} from './referenceData';
import {installReferenceCoordinateDisplay} from '../map/referenceCoordinateDisplay';

const REMOTE_ICON =
  'https://upload.wikimedia.org/wikipedia/commons/8/88/Map_marker.svg';

function featureStyle(feature: FeatureLike): Style {
  const kind = String(feature.get('kind'));
  if (kind === 'icon') {
    return new Style({
      image: new Icon({
        src: String(feature.get('src')),
        scale: Number(feature.get('scale')),
        anchor: [0.5, 1],
        rotation: (Number(feature.get('rotation')) * Math.PI) / 180,
        crossOrigin: feature.get('remote') ? 'anonymous' : undefined,
      }),
    });
  }
  if (kind === 'point1') {
    return new Style({
      image: new CircleStyle({
        radius: 12,
        fill: new Fill({color: 'rgba(220, 20, 60, 0.9)'}),
        stroke: new Stroke({color: 'darkred', width: 2}),
      }),
    });
  }
  if (kind === 'point2') {
    return new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({color: 'purple'}),
        stroke: new Stroke({color: 'indigo', width: 1.5}),
      }),
    });
  }
  if (kind === 'circle') {
    return new Style({
      fill: new Fill({color: 'rgba(173, 216, 230, 0.3)'}),
      stroke: new Stroke({color: 'rgba(70, 130, 180, 0.9)', width: 3}),
    });
  }
  if (kind === 'line') {
    return new Style({
      stroke: new Stroke({color: 'rgba(128, 0, 128, 0.8)', width: 3}),
    });
  }
  if (kind === 'polygon') {
    return new Style({
      fill: new Fill({color: 'rgba(144, 238, 144, 0.4)'}),
      stroke: new Stroke({color: 'rgba(0, 100, 0, 0.95)', width: 2.5}),
    });
  }
  return new Style({
    fill: new Fill({color: 'rgba(255, 215, 0, 0.25)'}),
    stroke: new Stroke({color: 'rgba(255, 165, 0, 0.9)', width: 2}),
  });
}

function selectedStyle(feature: FeatureLike): Style | Style[] {
  if (feature.getId() === 'icon_path_object') {
    return new Style({
      image: new Icon({
        src: '/resources/selected_pin.svg',
        scale: 0.75,
        anchor: [0.5, 1],
        rotation: (-30 * Math.PI) / 180,
      }),
    });
  }
  if (feature.get('kind') === 'icon') {
    return [
      new Style({
        image: new CircleStyle({
          radius: 13,
          fill: new Fill({color: 'rgba(0, 200, 255, 0.35)'}),
          stroke: new Stroke({color: '#00c8ff', width: 2}),
        }),
      }),
      featureStyle(feature),
    ];
  }
  const geometryType = feature.getGeometry()?.getType();
  if (geometryType === 'Point') {
    return new Style({
      image: new CircleStyle({
        radius: 14,
        fill: new Fill({color: 'rgba(0, 255, 255, 0.35)'}),
        stroke: new Stroke({color: '#00ffff', width: 3}),
      }),
    });
  }
  return new Style({
    fill: new Fill({color: 'rgba(0, 255, 255, 0.35)'}),
    stroke: new Stroke({color: '#00ffff', width: 4}),
  });
}

function buildFeatures(): Feature[] {
  const features: Feature[] = [];
  const point1 = new Feature(new Point(fromLonLat([-122.4194, 37.7749])));
  point1.setId('point1');
  point1.set('kind', 'point1');
  features.push(point1);

  const iconRows: readonly [number, number, string, string][] = [
    [
      37.8044,
      -122.2712,
      'path_object',
      'Icon from pathlib.Path with selected icon',
    ],
    [37.8715, -122.273, 'path_string', 'Icon from local path string'],
    [37.83, -122.35, 'bytes', 'Icon from bytes'],
    [37.78, -122.3, 'bytearray', 'Icon from bytearray'],
    [37.73, -122.27, 'memoryview', 'Icon from memoryview'],
    [37.68, -122.3, 'qbytearray', 'Icon from PySide6 QByteArray'],
    [37.6879, -122.4702, 'data_uri', 'Icon from data URI'],
  ];
  iconRows.forEach(([latitude, longitude, id, name], index) => {
    const feature = new Feature(new Point(fromLonLat([longitude, latitude])));
    feature.setId(`icon_${id}`);
    feature.setProperties({
      kind: 'icon',
      src: '/resources/orange_pin.svg',
      scale: 0.75,
      rotation: (index - 3) * 10,
      name,
    });
    features.push(feature);
  });
  const remoteIcon = new Feature(new Point(fromLonLat([-122.3255, 37.563])));
  remoteIcon.setId('icon_url');
  remoteIcon.setProperties({
    kind: 'icon',
    src: REMOTE_ICON,
    scale: 0.08,
    rotation: 0,
    remote: true,
    name: 'Icon from remote URL',
  });
  features.push(remoteIcon);

  const circle = new Feature(
    new CircleGeometry(fromLonLat([-122.2712, 37.8044]), 5_000)
  );
  circle.setId('circle1');
  circle.set('kind', 'circle');
  features.push(circle);

  const line = new Feature(
    new LineString([
      fromLonLat([-122.4194, 37.7749]),
      fromLonLat([-122.2712, 37.8044]),
      fromLonLat([-122.2, 37.75]),
    ])
  );
  line.setId('line1');
  line.set('kind', 'line');
  features.push(line);

  const polygon = new Feature(
    new Polygon([
      [
        fromLonLat([-122.5, 37.7]),
        fromLonLat([-122.35, 37.7]),
        fromLonLat([-122.425, 37.65]),
        fromLonLat([-122.5, 37.7]),
      ],
    ])
  );
  polygon.setId('polygon1');
  polygon.set('kind', 'polygon');
  features.push(polygon);

  const ellipse = new Feature(
    createEllipsePolygon(37.75, -122.2, 3_000, 1_500, 45)
  );
  ellipse.setId('ellipse1');
  ellipse.set('kind', 'ellipse');
  features.push(ellipse);

  const point2 = new Feature(new Point(fromLonLat([-122.48, 37.72])));
  point2.setId('point2');
  point2.set('kind', 'point2');
  features.push(point2);
  return features;
}

/** Browser port of examples/02_layer_types_and_styling.py. */
export function LayerTypesExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapTargetRef.current) return;
    document.title = 'Layer Types and Styling with QColor';
    const layer = new VectorLayer({
      source: new VectorSource({features: buildFeatures()}),
      style: featureStyle,
    });
    const map = new Map({
      target: mapTargetRef.current,
      layers: [new TileLayer({source: new OSM({transition: 0})}), layer],
      view: new View({
        center: fromLonLat([-122.4194, 37.7749]),
        zoom: 10,
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
        style: selectedStyle,
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
