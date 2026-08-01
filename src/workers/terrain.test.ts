import assert from "node:assert/strict";
import test from "node:test";
import { WEB_MERCATOR_WORLD_WIDTH_M } from "./grid";
import { TERRAIN_TILE_SIZE, TerrariumTerrainProvider } from "./terrain";

function tileWithElevation(elevationM: number): Uint8ClampedArray {
  const encoded = elevationM + 32768;
  const r = Math.floor(encoded / 256);
  const g = Math.floor(encoded - r * 256);
  const b = Math.round((encoded - Math.floor(encoded)) * 256);
  const tile = new Uint8ClampedArray(TERRAIN_TILE_SIZE ** 2 * 4);
  for (let i = 0; i < tile.length; i += 4) {
    tile[i] = r;
    tile[i + 1] = g;
    tile[i + 2] = b;
    tile[i + 3] = 255;
  }
  return tile;
}

test("Terrarium samples preserve negative elevations and ocean sea level", async () => {
  const negative = new TerrariumTerrainProvider(async () => tileWithElevation(-430));
  assert.deepEqual(Array.from(await negative.sampleGrid(new Float64Array([0]), new Float64Array([0]), 1)), [-430]);

  const ocean = new TerrariumTerrainProvider(async () => tileWithElevation(0));
  assert.deepEqual(Array.from(await ocean.sampleGrid(new Float64Array([0]), new Float64Array([0]), 1)), [0]);
});

test("partial tile failure marks only unavailable samples as missing", async () => {
  const provider = new TerrariumTerrainProvider(async (_z, x) =>
    x === 0 ? tileWithElevation(-10) : null
  );
  const quarterWorld = WEB_MERCATOR_WORLD_WIDTH_M / 4;
  const result = await provider.sampleGrid(
    new Float64Array([-quarterWorld, quarterWorld]),
    new Float64Array([0, 0]),
    1,
  );
  assert.equal(result[0], -10);
  assert.equal(Number.isNaN(result[1]), true);
});

test("complete tile failure returns explicit missing samples", async () => {
  const provider = new TerrariumTerrainProvider(async () => null);
  const result = await provider.sampleGrid(
    new Float64Array([0, 1]),
    new Float64Array([0, 1]),
    1,
  );
  assert.equal(result.every(Number.isNaN), true);
});
