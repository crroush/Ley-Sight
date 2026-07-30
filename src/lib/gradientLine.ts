export type LatitudeLongitude = readonly [number, number];

/**
 * Expands every input segment into the same number of linear subsegments used
 * by the reference gradient-line implementation.
 */
export function expandGradientCoordinates(
  coordinates: readonly LatitudeLongitude[],
  interpolateSteps: number,
): LatitudeLongitude[] {
  if (coordinates.length < 2) {
    throw new Error("coordinates must contain at least two points");
  }
  if (!Number.isInteger(interpolateSteps) || interpolateSteps < 1) {
    throw new Error("interpolateSteps must be a positive integer");
  }
  if (interpolateSteps === 1) return [...coordinates];

  const expanded: LatitudeLongitude[] = [coordinates[0]];
  for (let segment = 0; segment < coordinates.length - 1; segment += 1) {
    const [latitude0, longitude0] = coordinates[segment];
    const [latitude1, longitude1] = coordinates[segment + 1];
    for (let step = 1; step <= interpolateSteps; step += 1) {
      const ratio = step / interpolateSteps;
      expanded.push([
        latitude0 + (latitude1 - latitude0) * ratio,
        longitude0 + (longitude1 - longitude0) * ratio,
      ]);
    }
  }
  return expanded;
}

/**
 * Resolves per-segment or per-vertex input values at each rendered segment's
 * midpoint. This mirrors the reference rendered-value calculation.
 */
export function renderedGradientValues(
  values: readonly number[],
  coordinateCount: number,
  interpolateSteps: number,
): number[] {
  const segmentCount = coordinateCount - 1;
  let vertexValues: number[];
  if (values.length === coordinateCount) {
    vertexValues = [...values];
  } else if (values.length === segmentCount) {
    vertexValues = new Array<number>(coordinateCount);
    vertexValues[0] = values[0];
    vertexValues[coordinateCount - 1] = values[segmentCount - 1];
    for (let index = 1; index < coordinateCount - 1; index += 1) {
      vertexValues[index] = (values[index - 1] + values[index]) / 2;
    }
  } else {
    throw new Error(
      "values length must equal coordinateCount or coordinateCount - 1",
    );
  }

  const rendered: number[] = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const value0 = vertexValues[segment];
    const value1 = vertexValues[segment + 1];
    for (let step = 1; step <= interpolateSteps; step += 1) {
      const midpoint = (step - 0.5) / interpolateSteps;
      rendered.push(value0 + (value1 - value0) * midpoint);
    }
  }
  return rendered;
}

/** Repeats one explicit input color for every rendered subsegment. */
export function expandSegmentColors(
  colors: readonly string[],
  interpolateSteps: number,
): string[] {
  return colors.flatMap((color) =>
    Array.from({length: interpolateSteps}, () => color)
  );
}
