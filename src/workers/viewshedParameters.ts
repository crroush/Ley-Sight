export type ViewshedHeightParameters = {
  collectorClearanceM: number
  obstructionHeightAglM: number
}

/** Interim AWS Terrarium surface policy: missing and bathymetric values use MSL. */
export function visibleTerrainElevationM(elevationM: number): number {
  return Number.isFinite(elevationM) ? Math.max(0, elevationM) : 0
}

export function validateViewshedHeightParameters(
  parameters: ViewshedHeightParameters
): ViewshedHeightParameters {
  for (const [name, value] of Object.entries(parameters)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(
        `${name} must be a finite, non-negative number of meters`
      )
    }
  }
  return parameters
}

export function groundCollectorElevationM(
  bareEarthElevationM: number,
  collectorClearanceM: number
): number {
  return bareEarthElevationM + collectorClearanceM
}

export function effectiveObserverElevationM(
  kind: 'ground' | 'aircraft' | 'geo' | 'leo',
  storedAltitudeM: number,
  bareEarthElevationM: number,
  collectorClearanceM: number,
  highAltitudeThresholdM: number
): number {
  if (kind === 'ground') {
    return groundCollectorElevationM(bareEarthElevationM, collectorClearanceM)
  }
  return Math.max(
    storedAltitudeM || 0,
    storedAltitudeM < highAltitudeThresholdM ? bareEarthElevationM : 0
  )
}

/** The target remains bare-earth based; clutter is only an intervening surface. */
export function modeledProfileElevationM(
  bareEarthElevationM: number,
  sampleIndex: number,
  lastSampleIndex: number,
  obstructionHeightAglM: number
): number {
  const bareEarth = bareEarthElevationM
  return sampleIndex > 0 && sampleIndex < lastSampleIndex
    ? bareEarth + obstructionHeightAglM
    : bareEarth
}

export function addObstructionHeightToDem(
  bareEarthElevationsM: Float64Array,
  obstructionHeightAglM: number
): Float64Array {
  return Float64Array.from(
    bareEarthElevationsM,
    (elevationM) => elevationM + obstructionHeightAglM
  )
}

/**
 * The reference ellipsoid is not a physical obstruction where the DEM surface
 * lies below it. The terrain horizon already models the real surface there;
 * applying the ellipsoid solver as well would require a negative target to be
 * raised to 0 m and falsely classify shallow ocean and below-sea-level land.
 */
export function effectiveMinimumVisibleAltitudeM(
  bareEarthElevationM: number,
  geometricMvaM: number,
  terrainMvaM: number
): number {
  return Math.max(bareEarthElevationM < 0 ? 0 : geometricMvaM, terrainMvaM)
}

export function isProfileSampleBlocked(
  modeledTerrainElevationM: number,
  rayElevationM: number,
  grazingToleranceM: number = 0.5
): boolean {
  return (
    !Number.isFinite(rayElevationM) ||
    modeledTerrainElevationM > rayElevationM + grazingToleranceM
  )
}
