import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  createRoot,
  insert,
  nearestPoint,
  projectLonLat,
  rebuildVisibility,
  type PointAccessor,
} from './quadtree';

describe('quadtree', () => {
  it('indexes, queries, and bulk-rebuilds visibility', () => {
    const coordinates = Array.from({length: 5_000}, (_, index) => {
      const longitude = -120 + (index % 100) * 0.01;
      const latitude = 35 + Math.floor(index / 100) * 0.01;
      return projectLonLat(longitude, latitude)!;
    });
    const visible = new Uint8Array(coordinates.length);
    visible.fill(1);
    const accessor: PointAccessor = {
      x: (index) => coordinates[index][0],
      y: (index) => coordinates[index][1],
      isVisible: (index) => visible[index] === 1,
    };
    const root = createRoot();
    for (let index = 0; index < coordinates.length; index += 1) {
      insert(root, index, accessor);
    }
    assert.equal(root.visibleCount, coordinates.length);
    assert.equal(nearestPoint(root, accessor, coordinates[1234], 10), 1234);

    for (let index = 0; index < visible.length; index += 2) visible[index] = 0;
    assert.equal(rebuildVisibility(root, accessor), 2_500);
    assert.equal(root.visibleCount, 2_500);
  });

  it('normalizes 0-360 longitudes and selects points in wrapped worlds', () => {
    const coordinate = projectLonLat(350, 10)!;
    const visible = new Uint8Array([1]);
    const accessor: PointAccessor = {
      x: () => coordinate[0],
      y: () => coordinate[1],
      isVisible: () => visible[0] === 1,
    };
    const root = createRoot();
    insert(root, 0, accessor);
    assert.ok(coordinate[0] < 0);
    assert.equal(
      nearestPoint(
        root,
        accessor,
        [coordinate[0] + 40_075_016.68557849, coordinate[1]],
        10
      ),
      0
    );
  });
});
