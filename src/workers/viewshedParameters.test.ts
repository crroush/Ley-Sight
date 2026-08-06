import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addObstructionHeightToDem,
  effectiveMinimumVisibleAltitudeM,
  effectiveObserverElevationM,
  groundCollectorElevationM,
  isProfileSampleBlocked,
  modeledProfileElevationM,
  validateViewshedHeightParameters,
  visibleTerrainElevationM,
} from './viewshedParameters';

test('ground observer altitude is derived solely from DEM and clearance', () => {
  assert.equal(
    effectiveObserverElevationM('ground', 1609, 1600, 0, 100_000),
    1600
  );
  assert.equal(
    effectiveObserverElevationM('ground', 1609, 1600, 25, 100_000),
    1625
  );
  assert.equal(
    effectiveObserverElevationM('ground', 1609, 1600, 80, 100_000),
    1680
  );
});

function blocked(
  bare: number[],
  clearance: number,
  obstruction: number
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

test('collector clearance and modeled obstruction change synthetic visibility', () => {
  assert.equal(blocked([0, 0, 0], 0, 0), false, 'zero-height case');
  assert.equal(blocked([0, 2, 0], 5, 0), false, 'elevated antenna case');
  assert.equal(blocked([1, 1, 1], 0, 2), true, 'elevated blocker case');
  assert.equal(blocked([1, 1, 1], 5, 2), false, 'combined case');
});

test('zero-elevation land retains modeled clutter', () => {
  assert.equal(blocked([0, 0, 0], 2, 30), true);
  assert.equal(modeledProfileElevationM(0, 1, 2, 30), 30);
  assert.deepEqual(
    Array.from(addObstructionHeightToDem(new Float64Array([0, 4, -4]), 30)),
    [30, 34, 26]
  );
});

test('target endpoint remains bare-earth based', () => {
  assert.equal(modeledProfileElevationM(12, 1, 2, 8), 20);
  assert.equal(modeledProfileElevationM(12, 2, 2, 8), 12);
});

test('finite terrain below sea level is preserved throughout modeling', () => {
  assert.equal(groundCollectorElevationM(-430, 10), -420);
  assert.equal(modeledProfileElevationM(-50, 1, 2, 8), -42);
  assert.equal(modeledProfileElevationM(-50, 2, 2, 8), -50);
  assert.deepEqual(
    Array.from(addObstructionHeightToDem(new Float64Array([-100, 0, 20]), 5)),
    [-95, 5, 25]
  );
});

test('interim visible-surface policy flattens Terrarium bathymetry', () => {
  assert.equal(visibleTerrainElevationM(-11_000), 0);
  assert.equal(visibleTerrainElevationM(-1), 0);
  assert.equal(visibleTerrainElevationM(0), 0);
  assert.equal(visibleTerrainElevationM(125), 125);
  assert.equal(visibleTerrainElevationM(Number.NaN), 0);
  assert.equal(
    effectiveObserverElevationM(
      'ground',
      -11_000,
      visibleTerrainElevationM(-11_000),
      2,
      100_000
    ),
    2,
    'ground observers use the same sea-level surface as the analysis grid'
  );
});

test('below-sea-level profiles retain the correct visibility classification', () => {
  assert.equal(blocked([-100, -100, -100], 0, 0), false);
  assert.equal(blocked([-100, -80, -100], 0, 0), true);
  assert.equal(blocked([-100, -100, -100], 25, 0), false);
});

test('a negative ray is above ground when crossing a deeper basin', () => {
  assert.equal(isProfileSampleBlocked(-200, -100), false);
  assert.equal(isProfileSampleBlocked(-50, -100), true);
  assert.equal(isProfileSampleBlocked(-200, Number.NEGATIVE_INFINITY), true);
});

test('the reference ellipsoid does not block targets on negative terrain', () => {
  assert.equal(
    effectiveMinimumVisibleAltitudeM(-1, 1.25, 0),
    0,
    'a shallow ocean target remains visible when its terrain horizon is clear'
  );
  assert.equal(
    effectiveMinimumVisibleAltitudeM(-430, 430, 12),
    12,
    'below-sea-level land continues to use its real terrain horizon'
  );
  assert.equal(
    effectiveMinimumVisibleAltitudeM(10, 4, 2),
    4,
    'terrain above the ellipsoid still uses geometric occultation'
  );
});

test('height parameters must be finite non-negative meters', () => {
  assert.deepEqual(
    validateViewshedHeightParameters({
      collectorClearanceM: 0,
      obstructionHeightAglM: 0,
    }),
    {collectorClearanceM: 0, obstructionHeightAglM: 0}
  );
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        validateViewshedHeightParameters({
          collectorClearanceM: invalid,
          obstructionHeightAglM: 0,
        }),
      RangeError
    );
    assert.throws(
      () =>
        validateViewshedHeightParameters({
          collectorClearanceM: 0,
          obstructionHeightAglM: invalid,
        }),
      RangeError
    );
  }
});
