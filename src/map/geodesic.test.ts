import assert from 'node:assert/strict';
import test from 'node:test';
import {fromLonLat, toLonLat} from 'ol/proj.js';
import {geodesicLine} from './geodesic';

test('geodesicLine bows a long east-west route toward the pole', () => {
  const coordinates = geodesicLine([
    fromLonLat([-60, 45]),
    fromLonLat([60, 45]),
  ]).getCoordinates();
  const midpoint = toLonLat(coordinates[Math.floor(coordinates.length / 2)]);
  assert.ok(coordinates.length > 2);
  assert.ok(midpoint[1] > 60, `expected a northern arc, got ${midpoint[1]}`);
  assert.deepEqual(toLonLat(coordinates[0]).map(Math.round), [-60, 45]);
  assert.deepEqual(toLonLat(coordinates.at(-1)!).map(Math.round), [60, 45]);
});

test('geodesicLine unwraps a dateline crossing into a short path', () => {
  const coordinates = geodesicLine([
    fromLonLat([170, 10]),
    fromLonLat([-170, 10]),
  ]).getCoordinates();
  for (let index = 1; index < coordinates.length; index += 1) {
    assert.ok(
      Math.abs(coordinates[index][0] - coordinates[index - 1][0]) < 3_000_000
    );
  }
});
