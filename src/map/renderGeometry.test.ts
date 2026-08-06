import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import ImageCanvasSource from 'ol/source/ImageCanvas.js';
import {fromLonLat, get as getProjection} from 'ol/proj.js';
import {
  coordinateToImagePixel,
  imageCanvasPixelSize,
} from './imageCanvasGeometry';
import {projectLonLatExact} from './projection';
import type {Extent} from './quadtree';

describe('OpenLayers image-canvas geometry', () => {
  it('receives device-pixel dimensions from ImageCanvasSource', () => {
    let receivedSize: [number, number] | null = null;
    const source = new ImageCanvasSource({
      ratio: 1,
      projection: 'EPSG:3857',
      canvasFunction: (_extent, _resolution, _pixelRatio, size) => {
        receivedSize = [size[0], size[1]];
        return {width: size[0], height: size[1]} as HTMLCanvasElement;
      },
    });
    source.getImageInternal(
      [-400, -300, 400, 300],
      1,
      2,
      getProjection('EPSG:3857')!
    );
    assert.deepEqual(receivedSize, [1_600, 1_200]);
  });

  it('does not multiply an already device-pixel-sized image', () => {
    const pixelRatio = 2;
    const cssSize: [number, number] = [800, 600];
    const sourceSize: [number, number] = [
      cssSize[0] * pixelRatio,
      cssSize[1] * pixelRatio,
    ];
    const canvasSize = imageCanvasPixelSize(sourceSize);
    assert.deepEqual(canvasSize, [1_600, 1_200]);

    const extent: Extent = [-80_000, -60_000, 80_000, 60_000];
    const centerPixel = coordinateToImagePixel([0, 0], extent, canvasSize);
    assert.deepEqual(centerPixel, [800, 600]);
    assert.deepEqual(
      centerPixel.map((value) => value / pixelRatio),
      [400, 300]
    );
  });

  it('matches OpenLayers Web Mercator projection at known locations', () => {
    const coordinates: Array<[number, number]> = [
      [0, 0],
      [-104.9903, 39.7392],
      [151.2093, -33.8688],
      [179.75, 70],
    ];
    for (const coordinate of coordinates) {
      const expected = fromLonLat(coordinate);
      const actual = projectLonLatExact(coordinate[0], coordinate[1]);
      assert.ok(actual);
      assert.ok(Math.abs(actual[0] - expected[0]) < 1e-8);
      assert.ok(Math.abs(actual[1] - expected[1]) < 1e-8);
    }
  });
});
