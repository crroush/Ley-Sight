import assert from "node:assert/strict";
import test from "node:test";
import {
  expandGradientCoordinates,
  expandSegmentColors,
  renderedGradientValues,
} from "./gradientLine";

test("gradient coordinates use the Reference subsegment count and endpoints", () => {
  const expanded = expandGradientCoordinates([[0, 0], [2, 4]], 4);
  assert.deepEqual(expanded, [
    [0, 0],
    [0.5, 1],
    [1, 2],
    [1.5, 3],
    [2, 4],
  ]);
});

test("per-segment values become interpolated midpoint values", () => {
  assert.deepEqual(
    renderedGradientValues([10, 20], 3, 2),
    [11.25, 13.75, 16.25, 18.75],
  );
});

test("explicit colors repeat for every Reference subsegment", () => {
  assert.deepEqual(
    expandSegmentColors(["red", "blue"], 3),
    ["red", "red", "red", "blue", "blue", "blue"],
  );
});
