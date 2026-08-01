export type ViewshedHeightParameters = {
  collectorClearanceM: number;
  obstructionHeightAglM: number;
};

export function validateViewshedHeightParameters(
  parameters: ViewshedHeightParameters,
): ViewshedHeightParameters {
  for (const [name, value] of Object.entries(parameters)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(
        `${name} must be a finite, non-negative number of meters`,
      );
    }
  }
  return parameters;
}

export function groundCollectorElevationM(
  bareEarthElevationM: number,
  collectorClearanceM: number,
): number {
  return Math.max(0, bareEarthElevationM) + collectorClearanceM;
}

/** The target remains bare-earth based; clutter is only an intervening surface. */
export function modeledProfileElevationM(
  bareEarthElevationM: number,
  sampleIndex: number,
  lastSampleIndex: number,
  obstructionHeightAglM: number,
): number {
  const bareEarth = Math.max(0, bareEarthElevationM);
  return sampleIndex > 0 && sampleIndex < lastSampleIndex
    ? bareEarth + obstructionHeightAglM
    : bareEarth;
}

export function addObstructionHeightToDem(
  bareEarthElevationsM: Float64Array,
  obstructionHeightAglM: number,
): Float64Array {
  return Float64Array.from(
    bareEarthElevationsM,
    (elevationM) => Math.max(0, elevationM) + obstructionHeightAglM,
  );
}
