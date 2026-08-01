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
  return bareEarthElevationM + collectorClearanceM;
}

export function effectiveObserverElevationM(
  kind: "ground" | "aircraft" | "geo" | "leo",
  storedAltitudeM: number,
  bareEarthElevationM: number,
  collectorClearanceM: number,
  highAltitudeThresholdM: number,
): number {
  if (kind === "ground") {
    return groundCollectorElevationM(bareEarthElevationM, collectorClearanceM);
  }
  return Math.max(
    storedAltitudeM || 0,
    storedAltitudeM < highAltitudeThresholdM
      ? bareEarthElevationM
      : 0,
  );
}

/** The target remains bare-earth based; clutter is only an intervening surface. */
export function modeledProfileElevationM(
  bareEarthElevationM: number,
  sampleIndex: number,
  lastSampleIndex: number,
  obstructionHeightAglM: number,
): number {
  const bareEarth = bareEarthElevationM;
  // Terrarium encodes open water as exactly zero. Uniform land clutter (trees
  // and buildings) must not turn the ocean into an artificial wall.
  const modeledObstructionHeight = bareEarth === 0 ? 0 : obstructionHeightAglM;
  return sampleIndex > 0 && sampleIndex < lastSampleIndex
    ? bareEarth + modeledObstructionHeight
    : bareEarth;
}

export function addObstructionHeightToDem(
  bareEarthElevationsM: Float64Array,
  obstructionHeightAglM: number,
): Float64Array {
  return Float64Array.from(
    bareEarthElevationsM,
    (elevationM) => elevationM === 0
      ? elevationM
      : elevationM + obstructionHeightAglM,
  );
}
