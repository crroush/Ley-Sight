import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveObserverElevationM,
  groundCollectorElevationM,
  modeledProfileElevationM,
  validateViewshedHeightParameters,
} from "./viewshedParameters";

test("ground observer altitude is derived solely from DEM and clearance", () => {
  assert.equal(effectiveObserverElevationM("ground", 1609, 1600, 0, 100_000), 1600);
  assert.equal(effectiveObserverElevationM("ground", 1609, 1600, 25, 100_000), 1625);
});

function blocked(
  bare: number[],
  clearance: number,
  obstruction: number,
): boolean {
  const observer = groundCollectorElevationM(bare[0], clearance);
  const target = Math.max(0, bare.at(-1)!);
  return bare.some((elevation, index) => {
    if (index === 0 || index === bare.length - 1) return false;
    const ray = observer + (index / (bare.length - 1)) * (target - observer);
    return (
      modeledProfileElevationM(elevation, index, bare.length - 1, obstruction) >
      ray + 0.5
    );
  });
}

test("collector clearance and modeled obstruction change synthetic visibility", () => {
  assert.equal(blocked([0, 0, 0], 0, 0), false, "zero-height case");
  assert.equal(blocked([0, 2, 0], 5, 0), false, "elevated antenna case");
  assert.equal(blocked([0, 0, 0], 0, 2), true, "elevated blocker case");
  assert.equal(blocked([0, 0, 0], 5, 2), false, "combined case");
});

test("target endpoint remains bare-earth based", () => {
  assert.equal(modeledProfileElevationM(12, 1, 2, 8), 20);
  assert.equal(modeledProfileElevationM(12, 2, 2, 8), 12);
});

test("height parameters must be finite non-negative meters", () => {
  assert.deepEqual(
    validateViewshedHeightParameters({
      collectorClearanceM: 0,
      obstructionHeightAglM: 0,
    }),
    { collectorClearanceM: 0, obstructionHeightAglM: 0 },
  );
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        validateViewshedHeightParameters({
          collectorClearanceM: invalid,
          obstructionHeightAglM: 0,
        }),
      RangeError,
    );
    assert.throws(
      () =>
        validateViewshedHeightParameters({
          collectorClearanceM: 0,
          obstructionHeightAglM: invalid,
        }),
      RangeError,
    );
  }
});
