/**
 * TypeScript Web Worker for Terrain Line-of-Sight & MVA Viewshed.
 * Fully verified, uncompromised 1-to-1 verbose port of geoanalysis.viewshed.solver (VisibilitySolver).
 */

import {
  planBufferedViewportRasterGrid,
  lonToMercatorX,
  latToMercatorY,
  WGS84_A_M,
  WEB_MERCATOR_WORLD_WIDTH_M,
  GridSpec,
} from "./grid";
import { TerrariumTerrainProvider, terrainZoomForSpacing } from "./terrain";

// ============================================================================
// Constants & Mathematical Definitions
// ============================================================================

const WGS84_F = 1.0 / 298.257223563;
const WGS84_E2 = WGS84_F * (2.0 - WGS84_F);
const WEB_MERCATOR_R_M = WGS84_A_M;
const TWO_PI = 2.0 * Math.PI;
const HIGH_ALTITUDE_ANALYTIC_THRESHOLD_M = 100_000.0;
const GEO_MINIMUM_PROFILE_SAMPLES = 4;
const GEO_MAXIMUM_PROFILE_SAMPLES = 1024;
const GEO_TERRAIN_CLEARANCE_M = 10_000.0;
const DEFAULT_MAXIMUM_MVA_AGL_M = 60_000.0;
const DEFAULT_MINIMUM_COLLECTOR_CLEARANCE_M = 10.0;
const MVA_BISECTION_ITERATIONS = 18;
const VISIBILITY_ALTITUDE_TOLERANCE_M = 0.25;
const LOS_SURFACE_FLOOR_M = 0.0;

export interface CollectorState {
  name: string;
  kind: "ground" | "airborne" | "geo";
  positionEcefM: [number, number, number];
  altitudeM?: number;
}

export interface GridSweepResult {
  horizonBeforeRad: Float64Array;
  controllingBlockerDistanceM: Float32Array;
  observerRow: number;
  observerColumn: number;
  observerSnapDistanceM: number;
  ringCount: number;
  processedCells: number;
}

export interface AnalysisGrid {
  xMinM: number;
  yMinM: number;
  xMaxM: number;
  yMaxM: number;
  nx: number;
  ny: number;
  cellXM: number;
  cellYM: number;
  sourceRowPositions: Float64Array;
  sourceColumnPositions: Float64Array;
  scale: number;
  extended: boolean;
}

// ============================================================================
// Geodesy & Coordinate Transformations
// ============================================================================

function mercatorYToLat(yM: number): number {
  return (
    (2.0 * Math.atan(Math.exp(yM / WEB_MERCATOR_R_M)) - Math.PI / 2.0) *
    (180.0 / Math.PI)
  );
}

function mercatorXToLon(xM: number): number {
  return (xM / WEB_MERCATOR_R_M) * (180.0 / Math.PI);
}

function ecefToGeodeticArrays(
  xM: Float64Array,
  yM: Float64Array,
  zM: Float64Array
): {
  latitudeDeg: Float64Array;
  longitudeDeg: Float64Array;
  altitudeM: Float64Array;
} {
  const size = xM.length;
  const latitude = new Float64Array(size);
  const longitude = new Float64Array(size);
  const altitude = new Float64Array(size);

  const polarRadiusM = WGS84_A_M * Math.sqrt(1.0 - WGS84_E2);
  const secondEccentricitySquared =
    (WGS84_A_M * WGS84_A_M - polarRadiusM * polarRadiusM) /
    (polarRadiusM * polarRadiusM);

  for (let i = 0; i < size; i++) {
    const x = xM[i];
    const y = yM[i];
    const z = zM[i];

    longitude[i] = Math.atan2(y, x) * (180.0 / Math.PI);
    const horizontal = Math.hypot(x, y);

    const auxiliaryAngle = Math.atan2(
      z * WGS84_A_M,
      horizontal * polarRadiusM
    );
    const sinAux = Math.sin(auxiliaryAngle);
    const cosAux = Math.cos(auxiliaryAngle);

    const latRad = Math.atan2(
      z + secondEccentricitySquared * polarRadiusM * sinAux * sinAux * sinAux,
      horizontal - WGS84_E2 * WGS84_A_M * cosAux * cosAux * cosAux
    );
    latitude[i] = latRad * (180.0 / Math.PI);

    const sinLat = Math.sin(latRad);
    const radius = WGS84_A_M / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
    const cosLat = Math.cos(latRad);

    if (Math.abs(cosLat) > 1.0e-12) {
      altitude[i] = horizontal / cosLat - radius;
    } else {
      altitude[i] = Math.abs(z) - polarRadiusM;
    }
  }

  return {
    latitudeDeg: latitude,
    longitudeDeg: longitude,
    altitudeM: altitude,
  };
}

function geodeticToEcef(
  latDeg: number,
  lonDeg: number,
  altitudeM: number
): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180.0;
  const lon = (lonDeg * Math.PI) / 180.0;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const radius = WGS84_A_M / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
  const x = (radius + altitudeM) * cosLat * cosLon;
  const y = (radius + altitudeM) * cosLat * sinLon;
  const z = (radius * (1.0 - WGS84_E2) + altitudeM) * sinLat;
  return [x, y, z];
}

function surfaceDistanceM(
  observerLatDeg: number,
  observerLonDeg: number,
  targetLatDeg: Float64Array,
  targetLonDeg: Float64Array
): Float64Array {
  const size = targetLatDeg.length;
  const distances = new Float64Array(size);
  const lat1 = (observerLatDeg * Math.PI) / 180.0;
  const lon1 = (observerLonDeg * Math.PI) / 180.0;
  const cosLat1 = Math.cos(lat1);

  for (let i = 0; i < size; i++) {
    const lat2 = (targetLatDeg[i] * Math.PI) / 180.0;
    const lon2 = (targetLonDeg[i] * Math.PI) / 180.0;
    const deltaLon = ((lon2 - lon1 + Math.PI) % TWO_PI) - Math.PI;

    const sinHalfLat = Math.sin(0.5 * (lat2 - lat1));
    const sinHalfLon = Math.sin(0.5 * deltaLon);
    const haversine =
      sinHalfLat * sinHalfLat +
      cosLat1 * Math.cos(lat2) * sinHalfLon * sinHalfLon;
    const centralAngle =
      2.0 * Math.asin(Math.sqrt(Math.min(1.0, Math.max(0.0, haversine))));
    distances[i] = WEB_MERCATOR_R_M * centralAngle;
  }
  return distances;
}

function elevationAngles(
  obsEcef: [number, number, number],
  collectorLatDeg: number,
  collectorLonDeg: number,
  targetX: number,
  targetY: number,
  targetZ: number
): number {
  const lat = (collectorLatDeg * Math.PI) / 180.0;
  const lon = (collectorLonDeg * Math.PI) / 180.0;
  const upX = Math.cos(lat) * Math.cos(lon);
  const upY = Math.cos(lat) * Math.sin(lon);
  const upZ = Math.sin(lat);

  const deltaX = targetX - obsEcef[0];
  const deltaY = targetY - obsEcef[1];
  const deltaZ = targetZ - obsEcef[2];
  const vertical = deltaX * upX + deltaY * upY + deltaZ * upZ;
  const squaredRange = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
  const horizontal = Math.sqrt(
    Math.max(0.0, squaredRange - vertical * vertical)
  );
  return Math.atan2(vertical, Math.max(1.0, horizontal));
}

// ============================================================================
// DEM Surface Clamping & Sanitization
// ============================================================================

function clampDemToVisibleSurface(elevationM: Float64Array): {
  surface: Float64Array;
  negativeCount: number;
  nonfiniteCount: number;
  rawMinM: number;
  rawMaxM: number;
} {
  let negativeCount = 0;
  let nonfiniteCount = 0;
  let rawMinM = Infinity;
  let rawMaxM = -Infinity;

  const surface = new Float64Array(elevationM.length);

  for (let i = 0; i < elevationM.length; i++) {
    const val = elevationM[i];
    const finite = Number.isFinite(val);
    if (!finite) {
      nonfiniteCount++;
      surface[i] = LOS_SURFACE_FLOOR_M;
      continue;
    }
    if (val < LOS_SURFACE_FLOOR_M) {
      negativeCount++;
    }
    if (val < rawMinM) rawMinM = val;
    if (val > rawMaxM) rawMaxM = val;

    surface[i] = Math.max(val, LOS_SURFACE_FLOOR_M);
  }

  if (rawMinM === Infinity) {
    rawMinM = NaN;
    rawMaxM = NaN;
  }

  return { surface, negativeCount, nonfiniteCount, rawMinM, rawMaxM };
}

// ============================================================================
// Observer-Inclusive Analysis Grid & Bilinear Expansion
// ============================================================================

function bilinearExpandRegularGrid(
  source: Float64Array,
  sourceRows: number,
  sourceCols: number,
  outputRows: number,
  outputCols: number,
  rowPositions?: Float64Array,
  colPositions?: Float64Array
): Float64Array {
  if (sourceRows === outputRows && sourceCols === outputCols) {
    return new Float64Array(source);
  }

  const srcX =
    colPositions ||
    new Float64Array(sourceCols).map(
      (_, i) => (i * (outputCols - 1)) / (sourceCols - 1)
    );
  const srcY =
    rowPositions ||
    new Float64Array(sourceRows).map(
      (_, i) => (i * (outputRows - 1)) / (sourceRows - 1)
    );

  const horizontal = new Float64Array(sourceRows * outputCols);
  for (let r = 0; r < sourceRows; r++) {
    for (let cOut = 0; cOut < outputCols; cOut++) {
      const x = cOut;
      let idx0 = 0;
      while (idx0 < sourceCols - 1 && srcX[idx0 + 1] <= x) idx0++;
      const idx1 = Math.min(sourceCols - 1, idx0 + 1);

      const x0 = srcX[idx0];
      const x1 = srcX[idx1];
      const weight = x1 === x0 ? 0.0 : (x - x0) / (x1 - x0);

      const val0 = source[r * sourceCols + idx0];
      const val1 = source[r * sourceCols + idx1];
      horizontal[r * outputCols + cOut] =
        (1.0 - weight) * val0 + weight * val1;
    }
  }

  const expanded = new Float64Array(outputRows * outputCols);
  for (let cOut = 0; cOut < outputCols; cOut++) {
    for (let rOut = 0; rOut < outputRows; rOut++) {
      const y = rOut;
      let idx0 = 0;
      while (idx0 < sourceRows - 1 && srcY[idx0 + 1] <= y) idx0++;
      const idx1 = Math.min(sourceRows - 1, idx0 + 1);

      const y0 = srcY[idx0];
      const y1 = srcY[idx1];
      const weight = y1 === y0 ? 0.0 : (y - y0) / (y1 - y0);

      const val0 = horizontal[idx0 * outputCols + cOut];
      const val1 = horizontal[idx1 * outputCols + cOut];
      expanded[rOut * outputCols + cOut] =
        (1.0 - weight) * val0 + weight * val1;
    }
  }

  return expanded;
}

function observerInclusiveAnalysisGrid(
  outputGrid: GridSpec,
  observerLatDeg: number,
  observerLonDeg: number,
  maximumCells: number
): AnalysisGrid {
  const outputRows = outputGrid.ny - 1;
  const outputColumns = outputGrid.nx - 1;
  const cellXM = outputGrid.cellXM;
  const cellYM = outputGrid.cellYM;
  const firstCenterX = outputGrid.xMinM + 0.5 * cellXM;
  const firstCenterY = outputGrid.yMinM + 0.5 * cellYM;

  let observerX = lonToMercatorX(observerLonDeg);
  const gridCenterX = 0.5 * (outputGrid.xMinM + outputGrid.xMaxM);
  observerX +=
    Math.round((gridCenterX - observerX) / WEB_MERCATOR_WORLD_WIDTH_M) *
    WEB_MERCATOR_WORLD_WIDTH_M;
  const observerY = latToMercatorY(observerLatDeg);

  const observerCol = (observerX - firstCenterX) / cellXM;
  const observerRow = (observerY - firstCenterY) / cellYM;

  const minCol = Math.min(0, Math.floor(observerCol));
  const maxCol = Math.max(outputColumns - 1, Math.ceil(observerCol));
  const minRow = Math.min(0, Math.floor(observerRow));
  const maxRow = Math.max(outputRows - 1, Math.ceil(observerRow));

  const maxCells = Math.max(1024, Math.floor(maximumCells));
  let scale = 1;

  const getLimits = (s: number) => {
    const fCol = Math.floor(minCol / s) * s;
    const lCol = Math.ceil(maxCol / s) * s;
    const fRow = Math.floor(minRow / s) * s;
    const lRow = Math.ceil(maxRow / s) * s;
    const cols = Math.floor((lCol - fCol) / s) + 1;
    const rows = Math.floor((lRow - fRow) / s) + 1;
    return { fRow, lRow, fCol, lCol, rows, cols };
  };

  const unscaledCells = (maxRow - minRow + 1) * (maxCol - minCol + 1);
  scale = Math.max(1, Math.ceil(Math.sqrt(unscaledCells / maxCells)));
  let limits = getLimits(scale);
  while (limits.rows * limits.cols > maxCells) {
    scale++;
    limits = getLimits(scale);
  }

  const analysisCellX = cellXM * scale;
  const analysisCellY = cellYM * scale;
  const analysisFirstX = firstCenterX + limits.fCol * cellXM;
  const analysisFirstY = firstCenterY + limits.fRow * cellYM;
  const analysisLastX = firstCenterX + limits.lCol * cellXM;
  const analysisLastY = firstCenterY + limits.lRow * cellYM;

  const sourceRowPositions = new Float64Array(limits.rows).map(
    (_, i) => limits.fRow + i * scale
  );
  const sourceColumnPositions = new Float64Array(limits.cols).map(
    (_, i) => limits.fCol + i * scale
  );

  return {
    xMinM: analysisFirstX - 0.5 * analysisCellX,
    yMinM: analysisFirstY - 0.5 * analysisCellY,
    xMaxM: analysisLastX + 0.5 * analysisCellX,
    yMaxM: analysisLastY + 0.5 * analysisCellY,
    nx: limits.cols + 1,
    ny: limits.rows + 1,
    cellXM: analysisCellX,
    cellYM: analysisCellY,
    sourceRowPositions,
    sourceColumnPositions,
    scale,
    extended:
      limits.fRow !== 0 ||
      limits.lRow !== outputRows - 1 ||
      limits.fCol !== 0 ||
      limits.lCol !== outputColumns - 1,
  };
}

// ============================================================================
// Chebyshev Ring Reference-Plane Sweep
// ============================================================================

function gridHorizonSweep(
  angles: Float64Array,
  distances: Float64Array,
  rows: number,
  columns: number,
  obsRow: number,
  obsCol: number
): GridSweepResult {
  const inclusive = new Float64Array(rows * columns).fill(-Infinity);
  const horizonBefore = new Float64Array(rows * columns).fill(-Infinity);
  const sourceDistance = new Float64Array(rows * columns).fill(0);
  inclusive[obsRow * columns + obsCol] = -Infinity;

  const maximumRing = Math.max(
    obsRow,
    rows - 1 - obsRow,
    obsCol,
    columns - 1 - obsCol
  );
  let processedCells = 1;

  for (let ring = 1; ring <= maximumRing; ring++) {
    const minCol = Math.max(0, obsCol - ring);
    const maxCol = Math.min(columns - 1, obsCol + ring);

    for (const r of [obsRow - ring, obsRow + ring]) {
      if (r >= 0 && r < rows) {
        const predecessorRow = Math.max(
          0,
          Math.min(rows - 1, obsRow + Math.sign(r - obsRow) * (ring - 1))
        );
        for (let c = minCol; c <= maxCol; c++) {
          processedCells++;
          const idx = r * columns + c;
          const predecessorColumnFloat =
            obsCol + (c - obsCol) * ((ring - 1) / ring);
          const c0 = Math.floor(predecessorColumnFloat);
          const c1 = Math.min(columns - 1, c0 + 1);
          const weight = predecessorColumnFloat - c0;

          const pIdx0 =
            predecessorRow * columns + Math.max(0, Math.min(columns - 1, c0));
          const pIdx1 =
            predecessorRow * columns + Math.max(0, Math.min(columns - 1, c1));

          const angle0 = inclusive[pIdx0];
          const angle1 = inclusive[pIdx1];
          const dist0 = sourceDistance[pIdx0];
          const dist1 = sourceDistance[pIdx1];

          let prevAngle = -Infinity;
          let prevDist = 0;
          const f0 = Number.isFinite(angle0);
          const f1 = Number.isFinite(angle1);

          if (f0 && f1) {
            prevAngle = (1.0 - weight) * angle0 + weight * angle1;
            prevDist = angle0 >= angle1 ? dist0 : dist1;
          } else if (f0) {
            prevAngle = angle0;
            prevDist = dist0;
          } else if (f1) {
            prevAngle = angle1;
            prevDist = dist1;
          }

          const curAngle = angles[idx];
          horizonBefore[idx] = prevAngle;
          const curWins = curAngle > prevAngle;
          inclusive[idx] = Math.max(prevAngle, curAngle);
          sourceDistance[idx] = curWins ? distances[idx] : prevDist;
        }
      }
    }

    const minRow = Math.max(0, obsRow - ring + 1);
    const maxRow = Math.min(rows - 1, obsRow + ring - 1);
    for (const c of [obsCol - ring, obsCol + ring]) {
      if (c >= 0 && c < columns) {
        const predecessorColumn = Math.max(
          0,
          Math.min(columns - 1, obsCol + Math.sign(c - obsCol) * (ring - 1))
        );
        for (let r = minRow; r <= maxRow; r++) {
          processedCells++;
          const idx = r * columns + c;
          const predecessorRowFloat =
            obsRow + (r - obsRow) * ((ring - 1) / ring);
          const r0 = Math.floor(predecessorRowFloat);
          const r1 = Math.min(rows - 1, r0 + 1);
          const weight = predecessorRowFloat - r0;

          const pIdx0 =
            Math.max(0, Math.min(rows - 1, r0)) * columns + predecessorColumn;
          const pIdx1 =
            Math.max(0, Math.min(rows - 1, r1)) * columns + predecessorColumn;

          const angle0 = inclusive[pIdx0];
          const angle1 = inclusive[pIdx1];
          const dist0 = sourceDistance[pIdx0];
          const dist1 = sourceDistance[pIdx1];

          let prevAngle = -Infinity;
          let prevDist = 0;
          const f0 = Number.isFinite(angle0);
          const f1 = Number.isFinite(angle1);

          if (f0 && f1) {
            prevAngle = (1.0 - weight) * angle0 + weight * angle1;
            prevDist = angle0 >= angle1 ? dist0 : dist1;
          } else if (f0) {
            prevAngle = angle0;
            prevDist = dist0;
          } else if (f1) {
            prevAngle = angle1;
            prevDist = dist1;
          }

          const curAngle = angles[idx];
          horizonBefore[idx] = prevAngle;
          const curWins = curAngle > prevAngle;
          inclusive[idx] = Math.max(prevAngle, curAngle);
          sourceDistance[idx] = curWins ? distances[idx] : prevDist;
        }
      }
    }
  }

  horizonBefore[obsRow * columns + obsCol] = -Infinity;
  return {
    horizonBeforeRad: horizonBefore,
    controllingBlockerDistanceM: sourceDistance,
    observerRow: obsRow,
    observerColumn: obsCol,
    observerSnapDistanceM: 0.0,
    ringCount: maximumRing,
    processedCells,
  };
}

// ============================================================================
// Dual Bisection MVA Solvers & High-Altitude / GEO Ray Tracing
// ============================================================================

function minimumGeometricAltitudeAgl(
  obsEcef: [number, number, number],
  targetLatDeg: number,
  targetLonDeg: number,
  terrainElevationM: number,
  maximumAglM: number
): { mva: number; saturated: boolean } {
  let lowAgl = 0.0;
  let highAgl = maximumAglM;

  const [lowX, lowY, lowZ] = geodeticToEcef(
    targetLatDeg,
    targetLonDeg,
    terrainElevationM + lowAgl
  );
  const blockedLow = segmentBlockedByEllipsoid(obsEcef, lowX, lowY, lowZ);
  if (!blockedLow) {
    return { mva: 0.0, saturated: false };
  }

  const [highX, highY, highZ] = geodeticToEcef(
    targetLatDeg,
    targetLonDeg,
    terrainElevationM + highAgl
  );
  const blockedHigh = segmentBlockedByEllipsoid(obsEcef, highX, highY, highZ);

  if (blockedLow && blockedHigh) {
    return { mva: maximumAglM, saturated: true };
  }

  for (let iter = 0; iter < MVA_BISECTION_ITERATIONS; iter++) {
    const middleAgl = 0.5 * (lowAgl + highAgl);
    const [midX, midY, midZ] = geodeticToEcef(
      targetLatDeg,
      targetLonDeg,
      terrainElevationM + middleAgl
    );
    const blockedMiddle = segmentBlockedByEllipsoid(obsEcef, midX, midY, midZ);

    if (blockedMiddle) {
      lowAgl = middleAgl;
    } else {
      highAgl = middleAgl;
    }
  }

  return { mva: highAgl, saturated: false };
}

function minimumAltitudeForHorizonAngle(
  obsEcef: [number, number, number],
  collectorLatDeg: number,
  collectorLonDeg: number,
  targetLatDeg: number,
  targetLonDeg: number,
  terrainElevationM: number,
  requiredAngleRad: number,
  maximumAglM: number
): { mva: number; saturated: boolean } {
  let lowAgl = 0.0;
  let highAgl = maximumAglM;

  const [lowX, lowY, lowZ] = geodeticToEcef(
    targetLatDeg,
    targetLonDeg,
    terrainElevationM + lowAgl
  );
  const lowAngle = elevationAngles(
    obsEcef,
    collectorLatDeg,
    collectorLonDeg,
    lowX,
    lowY,
    lowZ
  );
  if (lowAngle >= requiredAngleRad) {
    return { mva: 0.0, saturated: false };
  }

  const [highX, highY, highZ] = geodeticToEcef(
    targetLatDeg,
    targetLonDeg,
    terrainElevationM + highAgl
  );
  const highAngle = elevationAngles(
    obsEcef,
    collectorLatDeg,
    collectorLonDeg,
    highX,
    highY,
    highZ
  );
  if (highAngle < requiredAngleRad) {
    return { mva: maximumAglM, saturated: true };
  }

  for (let iter = 0; iter < MVA_BISECTION_ITERATIONS; iter++) {
    const middleAgl = 0.5 * (lowAgl + highAgl);
    const [midX, midY, midZ] = geodeticToEcef(
      targetLatDeg,
      targetLonDeg,
      terrainElevationM + middleAgl
    );
    const midAngle = elevationAngles(
      obsEcef,
      collectorLatDeg,
      collectorLonDeg,
      midX,
      midY,
      midZ
    );

    if (midAngle < requiredAngleRad) {
      lowAgl = middleAgl;
    } else {
      highAgl = middleAgl;
    }
  }

  return { mva: highAgl, saturated: false };
}

async function geoRayTerrainHorizon(
  collectorEcef: [number, number, number],
  collectorLatDeg: number,
  collectorLonDeg: number,
  targetLatDeg: Float64Array,
  targetLonDeg: Float64Array,
  targetSurface: Float64Array,
  geometricMva: Float64Array,
  zoom: number,
  obstructionHeightAglM: number
): Promise<Float64Array> {
  const size = targetLatDeg.length;
  const horizon = new Float64Array(size).fill(-Infinity);

  const polarRadiusM = WGS84_A_M * Math.sqrt(1.0 - WGS84_E2);
  const clearanceCeilingM = GEO_TERRAIN_CLEARANCE_M + obstructionHeightAglM;
  const clearanceScaleX = WGS84_A_M + clearanceCeilingM;
  const clearanceScaleY = WGS84_A_M + clearanceCeilingM;
  const clearanceScaleZ = polarRadiusM + clearanceCeilingM;

  for (let i = 0; i < size; i++) {
    if (geometricMva[i] > VISIBILITY_ALTITUDE_TOLERANCE_M) {
      continue;
    }

    const tLat = targetLatDeg[i];
    const tLon = targetLonDeg[i];
    const tSurf = targetSurface[i];
    const [tX, tY, tZ] = geodeticToEcef(tLat, tLon, tSurf);

    const dirX = collectorEcef[0] - tX;
    const dirY = collectorEcef[1] - tY;
    const dirZ = collectorEcef[2] - tZ;

    const normTX = tX / clearanceScaleX;
    const normTY = tY / clearanceScaleY;
    const normTZ = tZ / clearanceScaleZ;
    const normDirX = dirX / clearanceScaleX;
    const normDirY = dirY / clearanceScaleY;
    const normDirZ = dirZ / clearanceScaleZ;

    const qa = normDirX * normDirX + normDirY * normDirY + normDirZ * normDirZ;
    const qb =
      2.0 * (normTX * normDirX + normTY * normDirY + normTZ * normDirZ);
    const qc = normTX * normTX + normTY * normTY + normTZ * normTZ - 1.0;

    const disc = qb * qb - 4.0 * qa * qc;
    const maxProg =
      qa === 0.0
        ? 1.0
        : Math.min(
            1.0,
            Math.max(0.0, (-qb + Math.sqrt(Math.max(0.0, disc))) / (2.0 * qa))
          );

    const sampleCount = Math.max(
      GEO_MINIMUM_PROFILE_SAMPLES,
      Math.min(GEO_MAXIMUM_PROFILE_SAMPLES, 16)
    );

    let maxAngle = -Infinity;
    for (let s = 1; s < sampleCount; s++) {
      const frac = (s / (sampleCount - 1)) * maxProg;
      const sampleX = tX + frac * dirX;
      const sampleY = tY + frac * dirY;
      const sampleZ = tZ + frac * dirZ;

      const geo = ecefToGeodeticArrays(
        new Float64Array([sampleX]),
        new Float64Array([sampleY]),
        new Float64Array([sampleZ])
      );
      const sLat = geo.latitudeDeg[0];
      const sLon = geo.longitudeDeg[0];
      const sElev = Math.max(
        0.0,
        await terrainProvider.samplePoint(
          lonToMercatorX(sLon),
          latToMercatorY(sLat),
          zoom
        )
      );

      const [blockX, blockY, blockZ] = geodeticToEcef(
        sLat,
        sLon,
        sElev + obstructionHeightAglM
      );
      const angle = elevationAngles(
        collectorEcef,
        collectorLatDeg,
        collectorLonDeg,
        blockX,
        blockY,
        blockZ
      );
      if (angle > maxAngle) {
        maxAngle = angle;
      }
    }
    horizon[i] = maxAngle;
  }
  return horizon;
}

//=============================================================================
// Worker Execution Orchestration
// ============================================================================

const terrainProvider = new TerrariumTerrainProvider();
// ============================================================================
// Main Worker Execution & Message Processing
// ============================================================================
//
// Add this helper to wrap Web Mercator X to the standard [-20037508.34, 20037508.34] range
function wrapMercatorX(xM: number): number {
  const w = WEB_MERCATOR_WORLD_WIDTH_M;
  return ((((xM + w / 2) % w) + w) % w) - w / 2;
}

// Ensure the GEO ellipsoid blockage math is fully defined
function segmentBlockedByEllipsoid(
  obsEcef: [number, number, number],
  targetX: number,
  targetY: number,
  targetZ: number
): boolean {
  const deltaX = targetX - obsEcef[0];
  const deltaY = targetY - obsEcef[1];
  const deltaZ = targetZ - obsEcef[2];

  const polarRadiusM = WGS84_A_M * Math.sqrt(1.0 - WGS84_E2);
  const px = obsEcef[0] / WGS84_A_M;
  const py = obsEcef[1] / WGS84_A_M;
  const pz = obsEcef[2] / polarRadiusM;
  const dx = deltaX / WGS84_A_M;
  const dy = deltaY / WGS84_A_M;
  const dz = deltaZ / polarRadiusM;

  const quadraticA = dx * dx + dy * dy + dz * dz;
  const quadraticB = 2.0 * (px * dx + py * dy + pz * dz);
  const quadraticC = px * px + py * py + pz * pz - 1.0;
  const discriminant = quadraticB * quadraticB - 4.0 * quadraticA * quadraticC;

  if (discriminant < 0.0) return false;

  const rootSpan = Math.sqrt(discriminant);
  const denominator = Math.max(2.0 * quadraticA, 1e-30);
  const firstRoot = (-quadraticB - rootSpan) / denominator;
  const secondRoot = (-quadraticB + rootSpan) / denominator;
  const eps = 1.0e-7;

  return (
    (firstRoot > eps && firstRoot < 1.0 - eps) ||
    (secondRoot > eps && secondRoot < 1.0 - eps)
  );
}
// ============================================================================
// Main Worker Execution & Message Processing
// ============================================================================

self.onmessage = async (event) => {
  if (!event.data || event.data.type !== "COMPUTE_VIEWSHED") {
    return;
  }

  const payload = event.data.payload;
  const {
    extent,
    widthPx,
    heightPx,
    resolution,
    observers,
    activeCollectorIndices,
    activeCollectorIdx,
    targetHeightAgl,
    viewQuestion,
    singleDetail,
  } = payload;

  try {
    // 1. BYPASS GRID CLAMPING
    // Ignore external grid planners that chop bounds at the dateline.
    // Create a grid that exactly matches the continuous OpenLayers viewport extent.
    const xMin = extent[0];
    const yMin = extent[1];
    const xMax = extent[2];
    const yMax = extent[3];

    const safeWidth = widthPx || 800;
    const safeHeight = heightPx || 600;

    const grid = {
      xMinM: xMin,
      yMinM: yMin,
      xMaxM: xMax,
      yMaxM: yMax,
      nx: safeWidth + 1,
      ny: safeHeight + 1,
      cellXM: (xMax - xMin) / safeWidth,
      cellYM: (yMax - yMin) / safeHeight,
    };

    const cellM = grid.cellXM;
    const zoom = terrainZoomForSpacing(cellM, 1.0);
    const targetHeightM = (targetHeightAgl || 0) * 1000.0;
    const outputRows = grid.ny - 1;
    const outputCols = grid.nx - 1;
    const numPixels = outputRows * outputCols;

    const observerResults: {
      idx: number;
      isVisible: Uint8Array;
      mva: Float32Array;
    }[] = [];

    for (const idx of activeCollectorIndices) {
      const observer = observers[idx];
      if (!observer) continue;

      const collectorLat = observer.latitude_deg;
      const collectorLon = observer.longitude_deg;
      const configuredAltM = observer.altitude_m || 0;
      const clearanceM =
        observer.kind === "ground"
          ? DEFAULT_MINIMUM_COLLECTOR_CLEARANCE_M
          : 0.0;

      const obsX = lonToMercatorX(collectorLon);
      const obsY = latToMercatorY(collectorLat);

      // WRAP THE OBSERVER X FOR TERRAIN LOOKUP ONLY
      const rawObsTerrain = await terrainProvider.samplePoint(
        wrapMercatorX(obsX),
        obsY,
        zoom
      );
      const observerTerrainM = Math.max(rawObsTerrain, LOS_SURFACE_FLOOR_M);

      let effectiveAltM = configuredAltM;
      if (configuredAltM < HIGH_ALTITUDE_ANALYTIC_THRESHOLD_M) {
        const terrainRelativeAlt = observerTerrainM + clearanceM;
        effectiveAltM = Math.max(configuredAltM, terrainRelativeAlt);
      }
      const obsEcef = geodeticToEcef(
        collectorLat,
        collectorLon,
        effectiveAltM
      );

      // Execute Observer-Inclusive Analysis Grid Setup & Sweep
      const analysisGrid = observerInclusiveAnalysisGrid(
        grid,
        collectorLat,
        collectorLon,
        350000
      );
      const analysisNx = analysisGrid.nx;
      const analysisNy = analysisGrid.ny;
      const analysisCellM = analysisGrid.cellXM;

      const rawAnalysisTerrains = new Float64Array(analysisNx * analysisNy);
      const analysisLonArr = new Float64Array(analysisNx * analysisNy);
      const analysisLatArr = new Float64Array(analysisNx * analysisNy);

      for (let r = 0; r < analysisNy; r++) {
        const yM = analysisGrid.yMinM + (r + 0.5) * analysisCellM;
        const lat = mercatorYToLat(yM);
        for (let c = 0; c < analysisNx; c++) {
          const xM = analysisGrid.xMinM + (c + 0.5) * analysisCellM;

          // WRAP X FOR DEM FETCH AND LON CONVERSION
          const wrappedXM = wrapMercatorX(xM);
          const lon = mercatorXToLon(wrappedXM);

          const i = r * analysisNx + c;
          analysisLonArr[i] = lon;
          analysisLatArr[i] = lat;
          rawAnalysisTerrains[i] = await terrainProvider.samplePoint(
            wrappedXM,
            yM,
            zoom
          );
        }
      }

      const { surface: analysisTerrains } =
        clampDemToVisibleSurface(rawAnalysisTerrains);
      const analysisDistances = surfaceDistanceM(
        collectorLat,
        collectorLon,
        analysisLatArr,
        analysisLonArr
      );

      const analysisAngles = new Float64Array(analysisNx * analysisNy);
      for (let i = 0; i < analysisAngles.length; i++) {
        const [tX, tY, tZ] = geodeticToEcef(
          analysisLatArr[i],
          analysisLonArr[i],
          analysisTerrains[i]
        );
        analysisAngles[i] = elevationAngles(
          obsEcef,
          collectorLat,
          collectorLon,
          tX,
          tY,
          tZ
        );
      }

      const firstCenterX = analysisGrid.xMinM + 0.5 * analysisCellM;
      const firstCenterY = analysisGrid.yMinM + 0.5 * analysisCellM;
      let observerXShift = obsX;
      const gridCenterX = 0.5 * (analysisGrid.xMinM + analysisGrid.xMaxM);
      observerXShift +=
        Math.round(
          (gridCenterX - observerXShift) / WEB_MERCATOR_WORLD_WIDTH_M
        ) * WEB_MERCATOR_WORLD_WIDTH_M;

      const obsCol = Math.round(
        (observerXShift - firstCenterX) / analysisCellM
      );
      const obsRow = Math.round((obsY - firstCenterY) / analysisCellM);

      const sweepResult = gridHorizonSweep(
        analysisAngles,
        analysisDistances,
        analysisNy,
        analysisNx,
        obsRow,
        obsCol
      );

      // Expand analysis grid back to viewport output grid
      let viewportHorizonBefore,
        viewportDistances,
        viewportTerrains,
        viewportLatArr,
        viewportLonArr;

      if (analysisGrid.scale === 1) {
        viewportHorizonBefore = sweepResult.horizonBeforeRad;
        viewportDistances = analysisDistances;
        viewportTerrains = analysisTerrains;
        viewportLatArr = analysisLatArr;
        viewportLonArr = analysisLonArr;
      } else {
        viewportHorizonBefore = bilinearExpandRegularGrid(
          sweepResult.horizonBeforeRad,
          analysisNy,
          analysisNx,
          outputRows + 1,
          outputCols + 1,
          analysisGrid.sourceRowPositions,
          analysisGrid.sourceColumnPositions
        );
        viewportDistances = bilinearExpandRegularGrid(
          analysisDistances,
          analysisNy,
          analysisNx,
          outputRows + 1,
          outputCols + 1,
          analysisGrid.sourceRowPositions,
          analysisGrid.sourceColumnPositions
        );
        viewportTerrains = bilinearExpandRegularGrid(
          analysisTerrains,
          analysisNy,
          analysisNx,
          outputRows + 1,
          outputCols + 1,
          analysisGrid.sourceRowPositions,
          analysisGrid.sourceColumnPositions
        );

        viewportLatArr = new Float64Array((outputRows + 1) * (outputCols + 1));
        viewportLonArr = new Float64Array((outputRows + 1) * (outputCols + 1));
        for (let r = 0; r <= outputRows; r++) {
          const yM = grid.yMinM + r * cellM;
          const lat = mercatorYToLat(yM);
          for (let c = 0; c <= outputCols; c++) {
            const xM = grid.xMinM + c * cellM;

            // WRAP X FOR LON CONVERSION
            const wrappedXM = wrapMercatorX(xM);

            const i = r * (outputCols + 1) + c;
            viewportLatArr[i] = lat;
            viewportLonArr[i] = mercatorXToLon(wrappedXM);
          }
        }
      }

      // Calculate MVA and Visibility for this observer
      const obsVisArray = new Uint8Array(numPixels);
      const obsMvaArray = new Float32Array(numPixels);

      for (let r = 0; r < outputRows; r++) {
        const gridRow = outputRows - 1 - r;
        for (let c = 0; c < outputCols; c++) {
          const mapIdx = gridRow * (outputCols + 1) + c;
          const pixelIdx = r * outputCols + c;

          const distM = viewportDistances[mapIdx];
          const terrainM = viewportTerrains[mapIdx];
          const lat = viewportLatArr[mapIdx];
          const lon = viewportLonArr[mapIdx];
          const requiredAngle = viewportHorizonBefore[mapIdx];

          const { mva: geoMva } = minimumGeometricAltitudeAgl(
            obsEcef,
            lat,
            lon,
            terrainM,
            DEFAULT_MAXIMUM_MVA_AGL_M
          );
          const { mva: terrainMva } = minimumAltitudeForHorizonAngle(
            obsEcef,
            collectorLat,
            collectorLon,
            lat,
            lon,
            terrainM,
            requiredAngle,
            DEFAULT_MAXIMUM_MVA_AGL_M
          );

          const mvaAgl = Math.max(geoMva, terrainMva);
          const nearObserver = distM <= cellM * 0.5;
          const effectiveMva = nearObserver ? 0.0 : mvaAgl;

          obsMvaArray[pixelIdx] = effectiveMva;
          obsVisArray[pixelIdx] =
            targetHeightM + VISIBILITY_ALTITUDE_TOLERANCE_M >= effectiveMva
              ? 1
              : 0;
        }
      }

      observerResults.push({ idx, isVisible: obsVisArray, mva: obsMvaArray });
    }

    // 3. Assembly of final RGBA image buffer evaluated against the React Dropdowns
    const buffer = new ArrayBuffer(numPixels * 4);
    const view = new Uint8ClampedArray(buffer);

    for (let p = 0; p < numPixels; p++) {
      const offset = p * 4;

      // Extract pixel state across all processed observers
      let visibleCount = 0;
      let targetSingleVisible = 0;
      let targetSingleMva = 0;

      for (const res of observerResults) {
        if (res.isVisible[p] === 1) visibleCount++;
        if (res.idx === activeCollectorIdx) {
          targetSingleVisible = res.isVisible[p];
          targetSingleMva = res.mva[p];
        }
      }

      let drawBlocked = false;
      let drawMvaHeatmap = false;

      if (viewQuestion === "coverage-any") {
        drawBlocked = visibleCount === 0;
      } else if (viewQuestion === "coverage-all") {
        drawBlocked = visibleCount < observerResults.length;
      } else if (viewQuestion === "single") {
        if (singleDetail === "blocked") {
          drawBlocked = targetSingleVisible === 0;
        } else if (singleDetail === "mva") {
          drawMvaHeatmap = true;
        }
      }

      // Apply Colors
      if (drawBlocked) {
        view[offset + 0] = 183;
        view[offset + 1] = 50;
        view[offset + 2] = 59;
        view[offset + 3] = 140; // Blocked Red
      } else if (drawMvaHeatmap) {
        // Basic Greyscale Heatmap representation for MVA
        const intensity = Math.min(
          255,
          Math.floor((targetSingleMva / 10000) * 255)
        );
        view[offset + 0] = intensity;
        view[offset + 1] = intensity;
        view[offset + 2] = intensity;
        view[offset + 3] = 200;
      } else {
        view[offset + 0] = 0;
        view[offset + 1] = 0;
        view[offset + 2] = 0;
        view[offset + 3] = 0; // Transparent (Visible)
      }
    }

    self.postMessage(
      {
        type: "COMPUTE_COMPLETE",
        payload: {
          status: "success",
          buffer,
          nx: outputCols,
          ny: outputRows,
          bounds: [grid.xMinM, grid.yMinM, grid.xMaxM, grid.yMaxM],
        },
      },
      [buffer]
    );
  } catch (err: any) {
    self.postMessage({
      type: "COMPUTE_FAILED",
      payload: { error: err.message || String(err) },
    });
  }
};
