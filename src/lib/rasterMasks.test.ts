import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {insideMask, polygonForMask, type MaskShape} from './rasterMasks';

const POLYGON_MASKS: MaskShape[] = ['triangle', 'hexagon', 'star', 'irregular'];

describe('Reference-compatible raster masks', () => {
  it('keeps each polygon center connected while excluding corners', () => {
    for (const mask of POLYGON_MASKS) {
      const polygon = polygonForMask(mask, 512, 512);
      assert.ok(polygon);
      assert.equal(insideMask(256, 256, 512, 512, mask, polygon), true);
      assert.equal(insideMask(5, 5, 512, 512, mask, polygon), false);
    }
  });

  it("uses the Reference star's alternating outer and inner radii", () => {
    const star = polygonForMask('star', 512, 512);
    assert.ok(star);
    assert.equal(star.length, 10);
    assert.ok(Math.abs(star[0][1] - 51.2) < 1e-9);
    assert.ok(Math.abs(star[1][0] - 304.148) < 0.01);
    // Regression: clamping a negative edge denominator made the entire
    // upper-right scanline opaque, producing the horizontal bands in v0.7.0.
    assert.equal(insideMask(256, 64, 512, 512, 'star', star), true);
    assert.equal(insideMask(400, 64, 512, 512, 'star', star), false);
  });

  it('uses the shortest image dimension for a truly circular mask', () => {
    assert.equal(insideMask(500, 250, 1_000, 500, 'circle', null), true);
    assert.equal(insideMask(750, 250, 1_000, 500, 'circle', null), false);
  });

  it('leaves the rectangle fully opaque', () => {
    assert.equal(insideMask(0, 0, 800, 300, 'rectangle', null), true);
    assert.equal(insideMask(799, 299, 800, 300, 'rectangle', null), true);
  });
});
