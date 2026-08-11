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

test('geodesicLine densifies antipodal endpoints along a deterministic arc', () => {
  const coordinates = geodesicLine([
    fromLonLat([0, 0]),
    fromLonLat([180, 0]),
  ]).getCoordinates();

  assert.ok(coordinates.length > 2);
  for (let index = 1; index < coordinates.length; index += 1) {
    assert.ok(
      Math.abs(coordinates[index][0] - coordinates[index - 1][0]) < 4_000_000,
      'expected antipodal arc to be split into bounded projected segments'
    );
  }
  const midpoint = toLonLat(coordinates[Math.floor(coordinates.length / 2)]);
  assert.ok(Math.abs(Math.abs(midpoint[0]) - 90) < 1);
  assert.ok(Math.abs(midpoint[1]) < 1);
});

test('geodesicLine avoids sub-pixel vertices at whole-world resolution', () => {
  const controls = [fromLonLat([-60, 45]), fromLonLat([60, 45])];
  const detailed = geodesicLine(controls, undefined, 1_000).getCoordinates();
  const wholeWorld = geodesicLine(
    controls,
    undefined,
    156_543
  ).getCoordinates();

  assert.ok(wholeWorld.length < detailed.length / 4);
  assert.ok(wholeWorld.length <= 10);
  const midpoint = toLonLat(wholeWorld[Math.floor(wholeWorld.length / 2)]);
  assert.ok(midpoint[1] > 60);
});
