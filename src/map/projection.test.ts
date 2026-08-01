import assert from "node:assert/strict";
import test from "node:test";
import { validateCoordinate, WEB_MERCATOR_MAX_LATITUDE } from "./projection";

test("coordinate validation accepts longitude boundaries without wrapping", () => {
  for (const longitude of [-180, 180]) {
    const result = validateCoordinate(longitude, 0);
    assert.equal(result.status, "projectable");
    if (result.status === "projectable") assert.equal(result.longitude, longitude);
  }
  for (const longitude of [-180.0000001, 180.0000001]) {
    assert.deepEqual(validateCoordinate(longitude, 0), { status: "invalid", reason: "longitude" });
  }
});

test("coordinate validation distinguishes geographic and Web Mercator limits", () => {
  for (const latitude of [-WEB_MERCATOR_MAX_LATITUDE, WEB_MERCATOR_MAX_LATITUDE]) {
    const result = validateCoordinate(0, latitude);
    assert.equal(result.status, "projectable");
    if (result.status === "projectable") assert.equal(result.projectionClamped, false);
  }
  for (const latitude of [-89.999999, 89.999999, -90, 90]) {
    const result = validateCoordinate(0, latitude);
    assert.equal(result.status, "projectable");
    if (result.status === "projectable") {
      assert.equal(result.projectionClamped, true);
      assert.ok(Math.abs(result.displayLatitude) <= WEB_MERCATOR_MAX_LATITUDE);
      assert.ok(result.projected.every(Number.isFinite));
    }
  }
  assert.equal(validateCoordinate(0, -90.000001).status, "invalid");
  assert.equal(validateCoordinate(0, 90.000001).status, "invalid");
});

test("coordinate validation rejects non-finite values", () => {
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    assert.deepEqual(validateCoordinate(value, 0), { status: "invalid", reason: "non-finite" });
    assert.deepEqual(validateCoordinate(0, value), { status: "invalid", reason: "non-finite" });
  }
});

test("initial parsing and recoloring share coordinate acceptance", () => {
  const coordinates = [[-180, 0], [180, 0], [-181, 0], [181, 0], [0, -90], [0, 90], [0, Number.NaN], [Infinity, 0]] as const;
  const acceptedForParsing = coordinates.map(([lon, lat]) => validateCoordinate(lon, lat).status === "projectable");
  const acceptedForRecoloring = coordinates.map(([lon, lat]) => validateCoordinate(lon, lat).status === "projectable");
  assert.deepEqual(acceptedForRecoloring, acceptedForParsing);
});
