import assert from 'node:assert/strict';
import test from 'node:test';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import {fromLonLat} from 'ol/proj.js';
import Style from 'ol/style/Style.js';
import {createMeasurementStyle} from './FastPointEngine';

test('measurement styling preserves raw controls and adapts to resolution', () => {
  const controls = [fromLonLat([-60, 45]), fromLonLat([60, 45])];
  const geometry = new LineString(controls);
  const feature = new Feature(geometry);
  const styleFunction = createMeasurementStyle('#ef4444');

  const detailed = styleFunction(feature, 1_000) as Style;
  const overview = styleFunction(feature, 156_543) as Style;
  const detailedGeometry = detailed.getGeometryFunction()(feature);
  const overviewGeometry = overview.getGeometryFunction()(feature);

  assert.ok(detailedGeometry instanceof LineString);
  assert.ok(overviewGeometry instanceof LineString);
  assert.ok(
    detailedGeometry.getCoordinates().length >
      overviewGeometry.getCoordinates().length
  );
  assert.deepEqual(geometry.getCoordinates(), controls);
});
