import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompactSpatialIndex } from "./compactIndex";
import {
  rebuildNodeSelectionCounts,
  selectExtentIntoMask,
} from "./selectionIndex";

describe("compact selection index", () => {
  it("selects a large extent directly into compact masks", () => {
    const count = 100_000;
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      x[index] = index;
      y[index] = index % 100;
    }
    const spatial = buildCompactSpatialIndex(x, y);
    const selected = new Uint8Array(count);
    const visible = new Uint8Array(count);
    visible.fill(1);
    const deleted = new Uint8Array(count);
    const nodeVisible = new Uint32Array(spatial.nodeStart.length);
    for (let node = 0; node < nodeVisible.length; node += 1) {
      nodeVisible[node] = spatial.nodeEnd[node] - spatial.nodeStart[node];
    }
    const nodeSelected = new Uint32Array(spatial.nodeStart.length);

    const selectedCount = selectExtentIntoMask(
      spatial,
      x,
      y,
      selected,
      visible,
      deleted,
      nodeVisible,
      nodeSelected,
      [25_000, -1, 74_999, 100],
    );
    assert.equal(selectedCount, 50_000);
    assert.equal(nodeSelected[0], 50_000);
    assert.equal(selected[24_999], 0);
    assert.equal(selected[25_000], 1);
    assert.equal(selected[74_999], 1);
    assert.equal(selected[75_000], 0);
  });

  it("drops selected rows that are no longer visible", () => {
    const x = Float64Array.from([0, 1, 2, 3]);
    const y = Float64Array.from([0, 1, 2, 3]);
    const spatial = buildCompactSpatialIndex(x, y);
    const selected = Uint8Array.from([1, 1, 1, 1]);
    const visible = Uint8Array.from([1, 0, 1, 1]);
    const deleted = Uint8Array.from([0, 0, 1, 0]);
    const nodeSelected = new Uint32Array(spatial.nodeStart.length);
    assert.equal(
      rebuildNodeSelectionCounts(
        spatial,
        selected,
        visible,
        deleted,
        nodeSelected,
      ),
      2,
    );
    assert.deepEqual(Array.from(selected), [1, 0, 0, 1]);
  });
});

const processEnv = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;

describe(
  "seven-million-point compact selection benchmark",
  { skip: !processEnv?.RUN_SEVEN_MILLION_SELECTION_BENCHMARK },
  () => {
    it("selects all rows without materializing an index list", { timeout: 30_000 }, () => {
      const count = 7_000_000;
      const x = new Float64Array(count);
      const y = new Float64Array(count);
      let state = 0x51a7cafe;
      const random = (): number => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state / 4_294_967_296;
      };
      for (let index = 0; index < count; index += 1) {
        x[index] = random() * 40_000_000 - 20_000_000;
        y[index] = random() * 40_000_000 - 20_000_000;
      }
      const spatial = buildCompactSpatialIndex(x, y);
      const selected = new Uint8Array(count);
      const visible = new Uint8Array(count);
      visible.fill(1);
      const deleted = new Uint8Array(count);
      const nodeVisible = new Uint32Array(spatial.nodeStart.length);
      for (let node = 0; node < nodeVisible.length; node += 1) {
        nodeVisible[node] = spatial.nodeEnd[node] - spatial.nodeStart[node];
      }
      const nodeSelected = new Uint32Array(spatial.nodeStart.length);

      const started = performance.now();
      const selectedCount = selectExtentIntoMask(
        spatial,
        x,
        y,
        selected,
        visible,
        deleted,
        nodeVisible,
        nodeSelected,
        [-20_000_000, -20_000_000, 20_000_000, 20_000_000],
      );
      const elapsed = performance.now() - started;
      console.info(
        `SEVEN_MILLION_COMPACT_SELECTION select_ms=${elapsed.toFixed(1)} mask_mb=${(
          (selected.byteLength + nodeSelected.byteLength) /
          1024 /
          1024
        ).toFixed(1)}`,
      );
      assert.equal(selectedCount, count);
      assert.equal(nodeSelected[0], count);
    });
  },
);
