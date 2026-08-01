/**
 * TypeScript Web Worker for Terrain Line-of-Sight & MVA Viewshed.
 * Faithful, uncompromised 1-to-1 port of geoanalysis.viewshed.solver (VisibilitySolver).
 */

import {
  lonToMercatorX,
  latToMercatorY,
  WGS84_A_M,
  WEB_MERCATOR_WORLD_WIDTH_M,
  GridSpec,
} from "./grid";
import { TerrariumTerrainProvider, terrainZoomForSpacing } from "./terrain";
import {
  addObstructionHeightToDem,
  effectiveObserverElevationM,
  validateViewshedHeightParameters,
} from "./viewshedParameters";

// ============================================================================
// 1. WGS84 Constants & Geodesy / Coordinate Transformations
// ============================================================================
const WGS84_F = 1.0 / 298.257223563;
const WGS84_E2 = WGS84_F * (2.0 - WGS84_F);
const WEB_MERCATOR_R_M = WGS84_A_M;
const TWO_PI = 2.0 * Math.PI;
const HIGH_ALTITUDE_ANALYTIC_THRESHOLD_M = 100_000.0;
const DEFAULT_MAXIMUM_MVA_AGL_M = 60_000.0;
const VISIBILITY_ALTITUDE_TOLERANCE_M = 0.25;
const LOS_SURFACE_FLOOR_M = 0.0;

export interface CollectorState {
  name: string;
  kind: "ground" | "aircraft" | "geo" | "leo";
  positionEcefM: [number, number, number];
  altitudeM?: number;
}

export interface ComputeViewshedPayload {
  runId: number;
  extent: [number, number, number, number];
  extentLatLon: {
    latMin: number;
    lonMin: number;
    latMax: number;
    lonMax: number;
  };
  resolution: number;
  widthPx: number;
  heightPx: number;
  observers: Array<{
    name: string;
    kind: "ground" | "aircraft" | "geo" | "leo";
    latitude_deg: number;
    longitude_deg: number;
    altitude_m: number;
  }>;
  activeCollectorIndices: number[];
  activeCollectorIdx: number;
  targetHeightAgl: number;
  collectorClearanceM: number;
  obstructionHeightAglM: number;
  viewQuestion: string;
  singleDetail: string;
}

export interface ComputeViewshedRequest {
  type: "COMPUTE_VIEWSHED";
  payload: ComputeViewshedPayload;
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

export interface GridSweepResult {
  horizonBeforeRad: Float64Array;
  controllingBlockerDistanceM: Float64Array;
  observerRow: number;
  observerColumn: number;
  observerSnapDistanceM: number;
  ringCount: number;
  processedCells: number;
}

function mercatorYToLat(yM: number): number {
  return (
    (2.0 * Math.atan(Math.exp(yM / WEB_MERCATOR_R_M)) - Math.PI / 2.0) *
    (180.0 / Math.PI)
  );
}

function mercatorXToLon(xM: number): number {
  return (xM / WEB_MERCATOR_R_M) * (180.0 / Math.PI);
}

function wrapMercatorX(xM: number): number {
  const w = WEB_MERCATOR_WORLD_WIDTH_M;
  return ((((xM + w / 2) % w) + w) % w) - w / 2;
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

// Retained for the smaller Analysis Grid sweep mapping
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
// 2. FAST Dual Bisection MVA Solvers (Zero-Allocation)
// ============================================================================

function elevationAnglesFast(
  obsX: number,
  obsY: number,
  obsZ: number,
  upX: number,
  upY: number,
  upZ: number,
  tX: number,
  tY: number,
  tZ: number
): number {
  const dX = tX - obsX;
  const dY = tY - obsY;
  const dZ = tZ - obsZ;
  const vertical = dX * upX + dY * upY + dZ * upZ;
  const sqRange = dX * dX + dY * dY + dZ * dZ;
  const horizontal = Math.sqrt(Math.max(0.0, sqRange - vertical * vertical));
  return Math.atan2(vertical, Math.max(1.0, horizontal));
}

function segmentBlockedByEllipsoidFast(
  obsX: number,
  obsY: number,
  obsZ: number,
  targetX: number,
  targetY: number,
  targetZ: number
): boolean {
  const polarRadiusM = WGS84_A_M * Math.sqrt(1.0 - WGS84_E2);
  const px = obsX / WGS84_A_M;
  const py = obsY / WGS84_A_M;
  const pz = obsZ / polarRadiusM;

  const dx = (targetX - obsX) / WGS84_A_M;
  const dy = (targetY - obsY) / WGS84_A_M;
  const dz = (targetZ - obsZ) / polarRadiusM;

  const quadA = dx * dx + dy * dy + dz * dz;
  const quadB = 2.0 * (px * dx + py * dy + pz * dz);
  const quadC = px * px + py * py + pz * pz - 1.0;
  const discriminant = quadB * quadB - 4.0 * quadA * quadC;

  if (discriminant < 0.0) return false;

  const rootSpan = Math.sqrt(discriminant);
  const denominator = Math.max(2.0 * quadA, 1e-30);
  const root1 = (-quadB - rootSpan) / denominator;
  const root2 = (-quadB + rootSpan) / denominator;
  const eps = 1.0e-7;

  return (
    (root1 > eps && root1 < 1.0 - eps) || (root2 > eps && root2 < 1.0 - eps)
  );
}

function mvaGeometricFast(
  obsX: number,
  obsY: number,
  obsZ: number,
  tRadius: number,
  tRadiusE2: number,
  tCosLatCosLon: number,
  tCosLatSinLon: number,
  tSinLat: number,
  baseElev: number,
  maxAgl: number
): number {
  let low = 0.0;
  let high = maxAgl;

  let x = (tRadius + baseElev) * tCosLatCosLon;
  let y = (tRadius + baseElev) * tCosLatSinLon;
  let z = (tRadiusE2 + baseElev) * tSinLat;
  if (!segmentBlockedByEllipsoidFast(obsX, obsY, obsZ, x, y, z)) return 0.0;

  x = (tRadius + baseElev + high) * tCosLatCosLon;
  y = (tRadius + baseElev + high) * tCosLatSinLon;
  z = (tRadiusE2 + baseElev + high) * tSinLat;
  if (segmentBlockedByEllipsoidFast(obsX, obsY, obsZ, x, y, z)) return maxAgl;

  for (let iter = 0; iter < 18; iter++) {
    const mid = 0.5 * (low + high);
    x = (tRadius + baseElev + mid) * tCosLatCosLon;
    y = (tRadius + baseElev + mid) * tCosLatSinLon;
    z = (tRadiusE2 + baseElev + mid) * tSinLat;
    if (segmentBlockedByEllipsoidFast(obsX, obsY, obsZ, x, y, z)) low = mid;
    else high = mid;
  }
  return high;
}

function mvaTerrainFast(
  obsX: number,
  obsY: number,
  obsZ: number,
  upX: number,
  upY: number,
  upZ: number,
  tRadius: number,
  tRadiusE2: number,
  tCosLatCosLon: number,
  tCosLatSinLon: number,
  tSinLat: number,
  baseElev: number,
  reqAngle: number,
  maxAgl: number
): number {
  let low = 0.0;
  let high = maxAgl;

  let x = (tRadius + baseElev) * tCosLatCosLon;
  let y = (tRadius + baseElev) * tCosLatSinLon;
  let z = (tRadiusE2 + baseElev) * tSinLat;
  if (
    elevationAnglesFast(obsX, obsY, obsZ, upX, upY, upZ, x, y, z) >= reqAngle
  )
    return 0.0;

  x = (tRadius + baseElev + high) * tCosLatCosLon;
  y = (tRadius + baseElev + high) * tCosLatSinLon;
  z = (tRadiusE2 + baseElev + high) * tSinLat;
  if (elevationAnglesFast(obsX, obsY, obsZ, upX, upY, upZ, x, y, z) < reqAngle)
    return maxAgl;

  for (let iter = 0; iter < 18; iter++) {
    const mid = 0.5 * (low + high);
    x = (tRadius + baseElev + mid) * tCosLatCosLon;
    y = (tRadius + baseElev + mid) * tCosLatSinLon;
    z = (tRadiusE2 + baseElev + mid) * tSinLat;
    if (
      elevationAnglesFast(obsX, obsY, obsZ, upX, upY, upZ, x, y, z) < reqAngle
    )
      low = mid;
    else high = mid;
  }
  return high;
}

// ============================================================================
// Profiling & Cooperative Cancellation State
// ============================================================================
let latestRunId = -1;
let lastYieldTime = 0;

async function checkCancelAndYield(currentRunId: number) {
  if (latestRunId !== currentRunId) throw new Error("CANCELLED");
  const now = performance.now();
  if (now - lastYieldTime > 40) {
    await new Promise((r) => setTimeout(r, 0));
    if (latestRunId !== currentRunId) throw new Error("CANCELLED");
    lastYieldTime = performance.now();
  }
}

class Profiler {
  private marks = new Map<string, number>();
  private totals = new Map<string, number>();

  start(label: string) {
    this.marks.set(label, performance.now());
  }
  end(label: string) {
    const start = this.marks.get(label);
    if (start) {
      this.totals.set(
        label,
        (this.totals.get(label) || 0) + (performance.now() - start)
      );
    }
  }
  print(runId: number) {
    console.group(`⏱️ Viewshed Profiler (Run ${runId})`);
    const table: any = {};
    let total = 0;
    this.totals.forEach((time, label) => {
      table[label] = { "Time (ms)": time.toFixed(2) };
      total += time;
    });
    table["Total Execution"] = { "Time (ms)": total.toFixed(2) };
    console.table(table);
    console.groupEnd();
  }
}

// ============================================================================
// 3. DEM Surface Sanitization & Batching
// ============================================================================
function clampDemToVisibleSurface(elevationM: Float64Array) {
  const surface = new Float64Array(elevationM.length);
  for (let i = 0; i < elevationM.length; i++) {
    surface[i] = Math.max(
      Number.isFinite(elevationM[i]) ? elevationM[i] : LOS_SURFACE_FLOOR_M,
      LOS_SURFACE_FLOOR_M
    );
  }
  return { surface };
}

const terrainProvider = new TerrariumTerrainProvider();

// ============================================================================
// 4. Observer-Inclusive Analysis Grid & Bilinear Expansion
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
  if (sourceRows === outputRows && sourceCols === outputCols)
    return new Float64Array(source);
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
      const weight =
        srcX[idx1] === srcX[idx0]
          ? 0.0
          : (x - srcX[idx0]) / (srcX[idx1] - srcX[idx0]);
      horizontal[r * outputCols + cOut] =
        (1.0 - weight) * source[r * sourceCols + idx0] +
        weight * source[r * sourceCols + idx1];
    }
  }
  const expanded = new Float64Array(outputRows * outputCols);
  for (let cOut = 0; cOut < outputCols; cOut++) {
    for (let rOut = 0; rOut < outputRows; rOut++) {
      const y = rOut;
      let idx0 = 0;
      while (idx0 < sourceRows - 1 && srcY[idx0 + 1] <= y) idx0++;
      const idx1 = Math.min(sourceRows - 1, idx0 + 1);
      const weight =
        srcY[idx1] === srcY[idx0]
          ? 0.0
          : (y - srcY[idx0]) / (srcY[idx1] - srcY[idx0]);
      expanded[rOut * outputCols + cOut] =
        (1.0 - weight) * horizontal[idx0 * outputCols + cOut] +
        weight * horizontal[idx1 * outputCols + cOut];
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
  const firstCenterX = outputGrid.xMinM + 0.5 * outputGrid.cellXM;
  const firstCenterY = outputGrid.yMinM + 0.5 * outputGrid.cellYM;
  let observerX = lonToMercatorX(observerLonDeg);
  observerX +=
    Math.round(
      (0.5 * (outputGrid.xMinM + outputGrid.xMaxM) - observerX) /
        WEB_MERCATOR_WORLD_WIDTH_M
    ) * WEB_MERCATOR_WORLD_WIDTH_M;

  const observerCol = (observerX - firstCenterX) / outputGrid.cellXM;
  const observerRow =
    (latToMercatorY(observerLatDeg) - firstCenterY) / outputGrid.cellYM;

  const minCol = Math.min(0, Math.floor(observerCol));
  const maxCol = Math.max(outputColumns, Math.ceil(observerCol));
  const minRow = Math.min(0, Math.floor(observerRow));
  const maxRow = Math.max(outputRows, Math.ceil(observerRow));

  let scale = Math.max(
    1,
    Math.ceil(
      Math.sqrt(
        ((maxRow - minRow + 1) * (maxCol - minCol + 1)) /
          Math.max(1024, maximumCells)
      )
    )
  );
  let limits = { fRow: 0, lRow: 0, fCol: 0, lCol: 0, rows: 0, cols: 0 };

  do {
    limits.fCol = Math.floor(minCol / scale) * scale;
    limits.lCol = Math.ceil(maxCol / scale) * scale;
    limits.fRow = Math.floor(minRow / scale) * scale;
    limits.lRow = Math.ceil(maxRow / scale) * scale;
    limits.cols = Math.floor((limits.lCol - limits.fCol) / scale) + 1;
    limits.rows = Math.floor((limits.lRow - limits.fRow) / scale) + 1;
    if (limits.rows * limits.cols <= Math.max(1024, maximumCells)) break;
    scale++;
  } while (true);

  return {
    xMinM:
      firstCenterX +
      limits.fCol * outputGrid.cellXM -
      0.5 * outputGrid.cellXM * scale,
    yMinM:
      firstCenterY +
      limits.fRow * outputGrid.cellYM -
      0.5 * outputGrid.cellYM * scale,
    xMaxM:
      firstCenterX +
      limits.lCol * outputGrid.cellXM +
      0.5 * outputGrid.cellXM * scale,
    yMaxM:
      firstCenterY +
      limits.lRow * outputGrid.cellYM +
      0.5 * outputGrid.cellYM * scale,
    nx: limits.cols,
    ny: limits.rows,
    cellXM: outputGrid.cellXM * scale,
    cellYM: outputGrid.cellYM * scale,
    sourceRowPositions: new Float64Array(limits.rows).map(
      (_, i) => limits.fRow + i * scale
    ),
    sourceColumnPositions: new Float64Array(limits.cols).map(
      (_, i) => limits.fCol + i * scale
    ),
    scale,
    extended:
      limits.fRow !== 0 ||
      limits.lRow !== outputRows ||
      limits.fCol !== 0 ||
      limits.lCol !== outputColumns,
  };
}

// ============================================================================
// 5. Async Chebyshev Ring Reference-Plane Sweep
// ============================================================================
async function gridHorizonSweep(
  angles: Float64Array,
  distances: Float64Array,
  rows: number,
  columns: number,
  obsRow: number,
  obsCol: number,
  runId: number
): Promise<GridSweepResult> {
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
    if (ring % 16 === 0) await checkCancelAndYield(runId);

    const minCol = Math.max(0, obsCol - ring);
    const maxCol = Math.min(columns - 1, obsCol + ring);
    for (const r of [obsRow - ring, obsRow + ring]) {
      if (r >= 0 && r < rows) {
        const pR = Math.max(
          0,
          Math.min(rows - 1, obsRow + Math.sign(r - obsRow) * (ring - 1))
        );
        for (let c = minCol; c <= maxCol; c++) {
          processedCells++;
          const idx = r * columns + c;
          const pColF = obsCol + (c - obsCol) * ((ring - 1) / ring);
          const c0 = Math.floor(pColF);
          const w = pColF - c0;
          const pIdx0 = pR * columns + Math.max(0, Math.min(columns - 1, c0));
          const pIdx1 =
            pR * columns + Math.max(0, Math.min(columns - 1, c0 + 1));

          let prevAngle = -Infinity,
            prevDist = 0;
          if (
            Number.isFinite(inclusive[pIdx0]) &&
            Number.isFinite(inclusive[pIdx1])
          ) {
            prevAngle = (1.0 - w) * inclusive[pIdx0] + w * inclusive[pIdx1];
            prevDist =
              inclusive[pIdx0] >= inclusive[pIdx1]
                ? sourceDistance[pIdx0]
                : sourceDistance[pIdx1];
          } else if (Number.isFinite(inclusive[pIdx0])) {
            prevAngle = inclusive[pIdx0];
            prevDist = sourceDistance[pIdx0];
          } else if (Number.isFinite(inclusive[pIdx1])) {
            prevAngle = inclusive[pIdx1];
            prevDist = sourceDistance[pIdx1];
          }

          horizonBefore[idx] = prevAngle;
          inclusive[idx] = Math.max(prevAngle, angles[idx]);
          sourceDistance[idx] =
            angles[idx] > prevAngle ? distances[idx] : prevDist;
        }
      }
    }

    const minRow = Math.max(0, obsRow - ring + 1);
    const maxRow = Math.min(rows - 1, obsRow + ring - 1);
    for (const c of [obsCol - ring, obsCol + ring]) {
      if (c >= 0 && c < columns) {
        const pC = Math.max(
          0,
          Math.min(columns - 1, obsCol + Math.sign(c - obsCol) * (ring - 1))
        );
        for (let r = minRow; r <= maxRow; r++) {
          processedCells++;
          const idx = r * columns + c;
          const pRowF = obsRow + (r - obsRow) * ((ring - 1) / ring);
          const r0 = Math.floor(pRowF);
          const w = pRowF - r0;
          const pIdx0 = Math.max(0, Math.min(rows - 1, r0)) * columns + pC;
          const pIdx1 = Math.max(0, Math.min(rows - 1, r0 + 1)) * columns + pC;

          let prevAngle = -Infinity,
            prevDist = 0;
          if (
            Number.isFinite(inclusive[pIdx0]) &&
            Number.isFinite(inclusive[pIdx1])
          ) {
            prevAngle = (1.0 - w) * inclusive[pIdx0] + w * inclusive[pIdx1];
            prevDist =
              inclusive[pIdx0] >= inclusive[pIdx1]
                ? sourceDistance[pIdx0]
                : sourceDistance[pIdx1];
          } else if (Number.isFinite(inclusive[pIdx0])) {
            prevAngle = inclusive[pIdx0];
            prevDist = sourceDistance[pIdx0];
          } else if (Number.isFinite(inclusive[pIdx1])) {
            prevAngle = inclusive[pIdx1];
            prevDist = sourceDistance[pIdx1];
          }

          horizonBefore[idx] = prevAngle;
          inclusive[idx] = Math.max(prevAngle, angles[idx]);
          sourceDistance[idx] =
            angles[idx] > prevAngle ? distances[idx] : prevDist;
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
// Main Worker Execution & Message Processing
// ============================================================================
self.onmessage = async (event: MessageEvent<ComputeViewshedRequest>) => {
  if (!event.data || event.data.type !== "COMPUTE_VIEWSHED") return;

  const payload: ComputeViewshedPayload = event.data.payload;
  const runId = payload.runId;
  latestRunId = runId;
  lastYieldTime = performance.now();

  const {
    extent,
    widthPx,
    heightPx,
    resolution,
    observers,
    activeCollectorIndices,
    activeCollectorIdx,
    targetHeightAgl,
    collectorClearanceM,
    obstructionHeightAglM,
    viewQuestion,
    singleDetail,
  } = payload;
  const profiler = new Profiler();

  try {
    validateViewshedHeightParameters({
      collectorClearanceM,
      obstructionHeightAglM,
    });
    profiler.start("Setup & Grid Generation");
    const safeWidth = Math.round(widthPx || 800);
    const safeHeight = Math.round(heightPx || 600);
    const grid = {
      xMinM: Number(extent[0]),
      yMinM: Number(extent[1]),
      xMaxM: Number(extent[2]),
      yMaxM: Number(extent[3]),
      nx: safeWidth + 1,
      ny: safeHeight + 1,
      cellXM: (Number(extent[2]) - Number(extent[0])) / safeWidth,
      cellYM: (Number(extent[3]) - Number(extent[1])) / safeHeight,
      viewResolutionMPerPx:
        resolution || (Number(extent[2]) - Number(extent[0])) / safeWidth,
    } as GridSpec;

    const zoom = terrainZoomForSpacing(grid.cellXM, 1.0);
    const targetHeightM = (targetHeightAgl || 0) * 1000.0;
    const outputRows = grid.ny - 1;
    const outputCols = grid.nx - 1;
    const numPixels = outputRows * outputCols;
    const observerResults: {
      idx: number;
      isVisible: Uint8Array;
      mva: Float32Array;
    }[] = [];
    profiler.end("Setup & Grid Generation");

    for (const idx of activeCollectorIndices) {
      await checkCancelAndYield(runId);
      const observer = observers[idx];
      if (!observer) continue;

      const collectorLat = observer.latitude_deg;
      const collectorLon = observer.longitude_deg;
      const obsX = lonToMercatorX(collectorLon);

      const rawObsTerrain = await terrainProvider.samplePoint(
        wrapMercatorX(obsX),
        latToMercatorY(collectorLat),
        zoom
      );
      const observerTerrainM = Math.max(rawObsTerrain, LOS_SURFACE_FLOOR_M);
      const effectiveAltM = effectiveObserverElevationM(
        observer.kind,
        observer.altitude_m,
        observerTerrainM,
        collectorClearanceM,
        HIGH_ALTITUDE_ANALYTIC_THRESHOLD_M
      );
      const obsEcef = geodeticToEcef(
        collectorLat,
        collectorLon,
        effectiveAltM
      );

      let viewportHorizonBefore,
        viewportDistances,
        viewportTerrains,
        viewportLatArr,
        viewportLonArr;

      profiler.start(`Observer ${idx} - Analysis Grid Projection`);
      const analysisGrid = observerInclusiveAnalysisGrid(
        grid,
        collectorLat,
        collectorLon,
        350000
      );
      const aNx = analysisGrid.nx,
        aNy = analysisGrid.ny;
      const aLon = new Float64Array(aNx * aNy),
        aLat = new Float64Array(aNx * aNy);
      const reqX = new Float64Array(aNx * aNy),
        reqY = new Float64Array(aNx * aNy);

      for (let r = 0; r < aNy; r++) {
        const yM = analysisGrid.yMinM + (r + 0.5) * analysisGrid.cellYM;
        const lat = mercatorYToLat(yM);
        for (let c = 0; c < aNx; c++) {
          const wrappedXM = wrapMercatorX(
            analysisGrid.xMinM + (c + 0.5) * analysisGrid.cellXM
          );
          const i = r * aNx + c;
          aLon[i] = mercatorXToLon(wrappedXM);
          aLat[i] = lat;
          reqX[i] = wrappedXM;
          reqY[i] = yM;
        }
      }
      profiler.end(`Observer ${idx} - Analysis Grid Projection`);

      profiler.start(`Observer ${idx} - Fetch Analysis Terrain`);
      const rawAnalysisTerrains = await terrainProvider.sampleGrid(
        reqX,
        reqY,
        zoom
      );
      const { surface: aTerrains } =
        clampDemToVisibleSurface(rawAnalysisTerrains);
      const aObstructionTerrains = addObstructionHeightToDem(
        aTerrains,
        obstructionHeightAglM
      );
      profiler.end(`Observer ${idx} - Fetch Analysis Terrain`);
      const aDist = surfaceDistanceM(collectorLat, collectorLon, aLat, aLon);
      const aAngles = new Float64Array(aNx * aNy);
      for (let i = 0; i < aAngles.length; i++) {
        const [tX, tY, tZ] = geodeticToEcef(
          aLat[i],
          aLon[i],
          aObstructionTerrains[i]
        );
        aAngles[i] = elevationAngles(
          obsEcef,
          collectorLat,
          collectorLon,
          tX,
          tY,
          tZ
        );
      }

      const firstCX = analysisGrid.xMinM + 0.5 * analysisGrid.cellXM;
      const firstCY = analysisGrid.yMinM + 0.5 * analysisGrid.cellYM;
      let obsXShift =
        obsX +
        Math.round(
          (0.5 * (analysisGrid.xMinM + analysisGrid.xMaxM) - obsX) /
            WEB_MERCATOR_WORLD_WIDTH_M
        ) *
          WEB_MERCATOR_WORLD_WIDTH_M;
      const oCol = Math.round((obsXShift - firstCX) / analysisGrid.cellXM);
      const oRow = Math.round(
        (latToMercatorY(collectorLat) - firstCY) / analysisGrid.cellYM
      );

      profiler.start(`Observer ${idx} - Chebyshev Horizon Sweep`);
      const sweep = await gridHorizonSweep(
        aAngles,
        aDist,
        aNy,
        aNx,
        oRow,
        oCol,
        runId
      );
      profiler.end(`Observer ${idx} - Chebyshev Horizon Sweep`);

      if (analysisGrid.scale === 1) {
        viewportHorizonBefore = sweep.horizonBeforeRad;
        viewportDistances = aDist;
        viewportTerrains = aTerrains;
        viewportLatArr = aLat;
        viewportLonArr = aLon;
      } else {
        profiler.start(`Observer ${idx} - Bilinear Expansion`);
        viewportHorizonBefore = bilinearExpandRegularGrid(
          sweep.horizonBeforeRad,
          aNy,
          aNx,
          outputRows + 1,
          outputCols + 1,
          analysisGrid.sourceRowPositions,
          analysisGrid.sourceColumnPositions
        );
        viewportDistances = bilinearExpandRegularGrid(
          aDist,
          aNy,
          aNx,
          outputRows + 1,
          outputCols + 1,
          analysisGrid.sourceRowPositions,
          analysisGrid.sourceColumnPositions
        );
        viewportTerrains = bilinearExpandRegularGrid(
          aTerrains,
          aNy,
          aNx,
          outputRows + 1,
          outputCols + 1,
          analysisGrid.sourceRowPositions,
          analysisGrid.sourceColumnPositions
        );

        viewportLatArr = new Float64Array(
          (outputRows + 1) * (outputCols + 1)
        );
        viewportLonArr = new Float64Array(
          (outputRows + 1) * (outputCols + 1)
        );
        for (let r = 0; r <= outputRows; r++) {
          const yM = grid.yMinM + r * grid.cellYM;
          const lat = mercatorYToLat(yM);
          for (let c = 0; c <= outputCols; c++) {
            const wrappedXM = wrapMercatorX(grid.xMinM + c * grid.cellXM);
            const i = r * (outputCols + 1) + c;
            viewportLatArr[i] = lat;
            viewportLonArr[i] = mercatorXToLon(wrappedXM);
          }
        }
        profiler.end(`Observer ${idx} - Bilinear Expansion`);
      }

      profiler.start(`Observer ${idx} - Dual Bisection MVA Solvers`);
      const obsVisArray = new Uint8Array(numPixels);
      const obsMvaArray = new Float32Array(numPixels);

      const obsLatRad = (collectorLat * Math.PI) / 180.0;
      const obsLonRad = (collectorLon * Math.PI) / 180.0;
      const upX = Math.cos(obsLatRad) * Math.cos(obsLonRad);
      const upY = Math.cos(obsLatRad) * Math.sin(obsLonRad);
      const upZ = Math.sin(obsLatRad);

      for (let r = 0; r < outputRows; r++) {
        if (r % 32 === 0) await checkCancelAndYield(runId);
        const gridRow = outputRows - 1 - r;

        for (let c = 0; c < outputCols; c++) {
          const mapIdx = gridRow * (outputCols + 1) + c;
          const pixelIdx = r * outputCols + c;

          const distM = viewportDistances[mapIdx];
          const terrainM = viewportTerrains[mapIdx];
          const lat = viewportLatArr[mapIdx];
          const lon = viewportLonArr[mapIdx];
          const requiredAngle = viewportHorizonBefore[mapIdx];

          if (distM <= grid.cellXM * 0.5) {
            obsMvaArray[pixelIdx] = 0.0;
            obsVisArray[pixelIdx] = 1;
            continue;
          }

          const tLatR = (lat * Math.PI) / 180.0;
          const tLonR = (lon * Math.PI) / 180.0;
          const tSinLat = Math.sin(tLatR);
          const tCosLat = Math.cos(tLatR);
          const tSinLon = Math.sin(tLonR);
          const tCosLon = Math.cos(tLonR);

          const tRadius =
            WGS84_A_M / Math.sqrt(1.0 - WGS84_E2 * tSinLat * tSinLat);
          const tRadiusE2 = tRadius * (1.0 - WGS84_E2);
          const tCosLatCosLon = tCosLat * tCosLon;
          const tCosLatSinLon = tCosLat * tSinLon;

          const mvaGeo = mvaGeometricFast(
            obsEcef[0],
            obsEcef[1],
            obsEcef[2],
            tRadius,
            tRadiusE2,
            tCosLatCosLon,
            tCosLatSinLon,
            tSinLat,
            terrainM,
            DEFAULT_MAXIMUM_MVA_AGL_M
          );

          const mvaTer = mvaTerrainFast(
            obsEcef[0],
            obsEcef[1],
            obsEcef[2],
            upX,
            upY,
            upZ,
            tRadius,
            tRadiusE2,
            tCosLatCosLon,
            tCosLatSinLon,
            tSinLat,
            terrainM,
            requiredAngle,
            DEFAULT_MAXIMUM_MVA_AGL_M
          );

          const effectiveMva = Math.max(mvaGeo, mvaTer);
          obsMvaArray[pixelIdx] = effectiveMva;
          obsVisArray[pixelIdx] =
            targetHeightM + VISIBILITY_ALTITUDE_TOLERANCE_M >= effectiveMva
              ? 1
              : 0;
        }
      }
      observerResults.push({ idx, isVisible: obsVisArray, mva: obsMvaArray });
      profiler.end(`Observer ${idx} - Dual Bisection MVA Solvers`);
    }

    profiler.start("RGBA Buffer Assembly");
    const buffer = new ArrayBuffer(numPixels * 4);
    const view = new Uint8ClampedArray(buffer);

    for (let p = 0; p < numPixels; p++) {
      if (p % 100000 === 0) await checkCancelAndYield(runId);
      const offset = p * 4;
      let visCount = 0,
        targetVis = 0,
        targetMva = 0;

      for (const res of observerResults) {
        if (res.isVisible[p] === 1) visCount++;
        if (res.idx === activeCollectorIdx) {
          targetVis = res.isVisible[p];
          targetMva = res.mva[p];
        }
      }

      const drawBlocked =
        viewQuestion === "coverage-any"
          ? visCount === 0
          : viewQuestion === "coverage-all"
          ? visCount < observerResults.length
          : viewQuestion === "single" && singleDetail === "blocked"
          ? targetVis === 0
          : false;
      const drawMva = viewQuestion === "single" && singleDetail === "mva";

      if (drawBlocked) {
        view[offset] = 183;
        view[offset + 1] = 50;
        view[offset + 2] = 59;
        view[offset + 3] = 140;
      } else if (drawMva) {
        const i = Math.min(255, Math.floor((targetMva / 10000) * 255));
        view[offset] = i;
        view[offset + 1] = i;
        view[offset + 2] = i;
        view[offset + 3] = 200;
      } else {
        view[offset] = 0;
        view[offset + 1] = 0;
        view[offset + 2] = 0;
        view[offset + 3] = 0;
      }
    }
    profiler.end("RGBA Buffer Assembly");
    profiler.print(runId);

    self.postMessage(
      {
        type: "COMPUTE_COMPLETE",
        payload: {
          runId,
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
    if (err.message === "CANCELLED") {
      console.log(
        `[Viewshed Worker] Run ${runId} cancelled by a newer viewport event.`
      );
      return;
    }
    console.error("Worker Computation Error:", err);
    self.postMessage({
      type: "COMPUTE_FAILED",
      payload: {
        runId, // Add runId here so the frontend can check if this failure is obsolete
        error: err.message || String(err),
      },
    });
  }
};
