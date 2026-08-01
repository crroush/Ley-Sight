import assert from "node:assert/strict";
import test from "node:test";
import {
  addObstructionHeightToDem,
  effectiveObserverElevationM,
  groundCollectorElevationM,
  modeledProfileElevationM,
  validateViewshedHeightParameters,
} from "./viewshedParameters";

test("ground observer altitude is derived solely from DEM and clearance", () => {
  assert.equal(effectiveObserverElevationM("ground", 1609, 1600, 0, 100_000), 1600);
  assert.equal(effectiveObserverElevationM("ground", 1609, 1600, 25, 100_000), 1625);
  assert.equal(effectiveObserverElevationM("ground", 1609, 1600, 80, 100_000), 1680);
});

function blocked(
  bare: number[],
  clearance: number,
  obstruction: number,
): boolean {
  const observer = groundCollectorElevationM(bare[0], clearance);
  const target = bare.at(-1)!;
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
  assert.equal(blocked([1, 1, 1], 0, 2), true, "elevated blocker case");
  assert.equal(blocked([1, 1, 1], 5, 2), false, "combined case");
});

test("modeled land clutter does not make ocean block a beach sensor", () => {
  assert.equal(blocked([0, 0, 0], 2, 30), false);
  assert.equal(modeledProfileElevationM(0, 1, 2, 30), 0);
  assert.deepEqual(
    Array.from(addObstructionHeightToDem(new Float64Array([0, 4, -4]), 30)),
    [0, 34, 26],
  );
});

test("target endpoint remains bare-earth based", () => {
  assert.equal(modeledProfileElevationM(12, 1, 2, 8), 20);
  assert.equal(modeledProfileElevationM(12, 2, 2, 8), 12);
});

test("finite terrain below sea level is preserved throughout modeling", () => {
  assert.equal(groundCollectorElevationM(-430, 10), -420);
  assert.equal(modeledProfileElevationM(-50, 1, 2, 8), -42);
  assert.equal(modeledProfileElevationM(-50, 2, 2, 8), -50);
  assert.deepEqual(
    Array.from(addObstructionHeightToDem(new Float64Array([-100, 0, 20]), 5)),
    [-95, 0, 25],
  );
});

test("below-sea-level profiles retain the correct visibility classification", () => {
  assert.equal(blocked([-100, -100, -100], 0, 0), false);
  assert.equal(blocked([-100, -80, -100], 0, 0), true);
  assert.equal(blocked([-100, -100, -100], 25, 0), false);
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
