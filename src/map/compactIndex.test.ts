import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCompactSpatialIndex,
  compactIndexBytes,
} from "./compactIndex";
import { WEB_MERCATOR_HALF_WORLD } from "./quadtree";

describe("compact spatial index", () => {
  it("bulk-builds a complete Morton-ordered index", () => {
    const count = 100_000;
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      x[index] = ((index % 1_000) / 999 * 2 - 1) * WEB_MERCATOR_HALF_WORLD;
      y[index] =
        ((Math.floor(index / 1_000) / 99) * 2 - 1) *
        WEB_MERCATOR_HALF_WORLD;
    }
    const spatial = buildCompactSpatialIndex(x, y);
    assert.equal(spatial.order.length, count);
    assert.equal(spatial.nodeStart[0], 0);
    assert.equal(spatial.nodeEnd[0], count);
    assert.equal(spatial.nodeFirstIndex[0], 0);
    const seen = new Uint8Array(count);
    for (let offset = 0; offset < spatial.order.length; offset += 1) {
      const index = spatial.order[offset];
      assert.equal(seen[index], 0);
      seen[index] = 1;
    }
    for (let node = 0; node < spatial.nodeStart.length; node += 1) {
      const childIds: number[] = [];
      for (let slot = 0; slot < 4; slot += 1) {
        const child = spatial.nodeChildren[node * 4 + slot];
        if (child >= 0) childIds.push(child);
      }
      if (!childIds.length) {
        assert.ok(spatial.nodeEnd[node] - spatial.nodeStart[node] <= 32);
        for (
          let offset = spatial.nodeStart[node] + 1;
          offset < spatial.nodeEnd[node];
          offset += 1
        ) {
          assert.ok(spatial.order[offset - 1] < spatial.order[offset]);
        }
        continue;
      }
      assert.equal(
        spatial.nodeStart[childIds[0]],
        spatial.nodeStart[node],
      );
      assert.equal(
        spatial.nodeEnd[childIds[childIds.length - 1]],
        spatial.nodeEnd[node],
      );
      for (let childOffset = 1; childOffset < childIds.length; childOffset += 1) {
        assert.equal(
          spatial.nodeStart[childIds[childOffset]],
          spatial.nodeEnd[childIds[childOffset - 1]],
        );
      }
    }
    assert.ok(compactIndexBytes(spatial) < count * 8);
  });
});

const processEnv = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;

describe(
  "seven-million-point compact index benchmark",
  { skip: !processEnv?.RUN_SEVEN_MILLION_BENCHMARK },
  () => {
    it("bulk-builds seven million points", { timeout: 30_000 }, () => {
      const count = 7_000_000;
      const x = new Float64Array(count);
      const y = new Float64Array(count);
      let state = 0x51a7cafe;
      const random = () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state / 4_294_967_296;
      };
      for (let index = 0; index < count; index += 1) {
        x[index] = (random() * 2 - 1) * WEB_MERCATOR_HALF_WORLD;
        y[index] = (random() * 2 - 1) * WEB_MERCATOR_HALF_WORLD;
      }
      const started = performance.now();
      const spatial = buildCompactSpatialIndex(x, y);
      const buildMs = performance.now() - started;
      console.info(
        `SEVEN_MILLION_COMPACT_INDEX build_ms=${buildMs.toFixed(1)} index_mb=${(
          compactIndexBytes(spatial) /
          1024 /
          1024
        ).toFixed(1)} nodes=${spatial.nodeStart.length}`,
      );
      assert.equal(spatial.order.length, count);
      assert.equal(spatial.nodeEnd[0], count);
    });
  },
);
