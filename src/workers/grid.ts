// src/workers/grid.ts

export const WGS84_A_M = 6378137.0;
export const WEB_MERCATOR_HALF_WORLD_M = Math.PI * WGS84_A_M;
export const WEB_MERCATOR_WORLD_WIDTH_M = 2.0 * WEB_MERCATOR_HALF_WORLD_M;
export const WEB_MERCATOR_MAX_LAT_DEG = 85.0511287798066;

export interface GridSpec {
  xMinM: number;
  yMinM: number;
  xMaxM: number;
  yMaxM: number;
  nx: number;
  ny: number;
  viewResolutionMPerPx: number;
  cellXM: number;
  cellYM: number;
}

export function lonToMercatorX(lonDeg: number): number {
  return WGS84_A_M * ((lonDeg * Math.PI) / 180.0);
}

export function latToMercatorY(latDeg: number): number {
  const lat = Math.max(
    -WEB_MERCATOR_MAX_LAT_DEG,
    Math.min(WEB_MERCATOR_MAX_LAT_DEG, latDeg)
  );
  return (
    WGS84_A_M *
    Math.log(Math.tan(Math.PI / 4.0 + (lat * Math.PI) / 180.0 / 2.0))
  );
}

export function continuousExtentX(
  lonMin: number,
  lonMax: number,
  resolution: number,
  widthPx: number,
  targetLonDeg: number
): [number, number] {
  const expectedWidth = Math.max(1e-9, resolution) * Math.max(1.0, widthPx);
  const xLeft = lonToMercatorX(lonMin);
  const xRightBase = lonToMercatorX(lonMax);
  const baseDelta = xRightBase - xLeft;

  const estimatedTurns = Math.round(
    (expectedWidth - baseDelta) / WEB_MERCATOR_WORLD_WIDTH_M
  );
  let bestXRight = xRightBase;
  let minDiff = Infinity;

  for (let turns = estimatedTurns - 2; turns <= estimatedTurns + 2; turns++) {
    const candidateXRight = xRightBase + turns * WEB_MERCATOR_WORLD_WIDTH_M;
    const width = candidateXRight - xLeft;
    if (width > 0.0) {
      const diff = Math.abs(width - expectedWidth);
      if (diff < minDiff) {
        minDiff = diff;
        bestXRight = candidateXRight;
      }
    }
  }

  if (minDiff === Infinity) {
    while (bestXRight <= xLeft) {
      bestXRight += WEB_MERCATOR_WORLD_WIDTH_M;
    }
  }

  const targetX = lonToMercatorX(targetLonDeg);
  const centerX = 0.5 * (xLeft + bestXRight);
  const shiftTurns = Math.round(
    (targetX - centerX) / WEB_MERCATOR_WORLD_WIDTH_M
  );
  const shiftM = shiftTurns * WEB_MERCATOR_WORLD_WIDTH_M;

  return [xLeft + shiftM, bestXRight + shiftM];
}

export function planBufferedViewportRasterGrid(
  extent: {
    lonMin: number;
    latMin: number;
    lonMax: number;
    latMax: number;
    widthPx: number;
    heightPx: number;
    resolution: number;
  },
  referenceLonDeg: number,
  pixelsPerCell: number = 4.0,
  bufferScreenPx: number = 96.0,
  maximumCellsPerAxis: number = 1600
): GridSpec {
  if (pixelsPerCell <= 0.0) throw new Error('pixelsPerCell must be positive');
  if (bufferScreenPx < 0.0)
    throw new Error('bufferScreenPx must be nonnegative');
  if (maximumCellsPerAxis < 1)
    throw new Error('maximumCellsPerAxis must be positive');

  const resolution = Math.max(1.0e-3, extent.resolution || 10000.0);
  const requestedCellM = resolution * pixelsPerCell;

  const [xMin, xMax] = continuousExtentX(
    extent.lonMin,
    extent.lonMax,
    resolution,
    extent.widthPx,
    referenceLonDeg
  );

  const latMin = Math.max(
    -WEB_MERCATOR_MAX_LAT_DEG,
    Math.min(WEB_MERCATOR_MAX_LAT_DEG, extent.latMin || -85.0)
  );
  const latMax = Math.max(
    -WEB_MERCATOR_MAX_LAT_DEG,
    Math.min(WEB_MERCATOR_MAX_LAT_DEG, extent.latMax || 85.0)
  );

  const yMin = Math.max(
    -WEB_MERCATOR_HALF_WORLD_M,
    latToMercatorY(Math.min(latMin, latMax))
  );
  const yMax = Math.min(
    WEB_MERCATOR_HALF_WORLD_M,
    latToMercatorY(Math.max(latMin, latMax))
  );

  const bufferM = resolution * bufferScreenPx;
  let desiredXMin = xMin - bufferM;
  let desiredXMax = xMax + bufferM;

  const isGlobalX =
    desiredXMax - desiredXMin >= 0.95 * WEB_MERCATOR_WORLD_WIDTH_M;
  if (isGlobalX) {
    desiredXMin = -WEB_MERCATOR_HALF_WORLD_M;
    desiredXMax = WEB_MERCATOR_HALF_WORLD_M;
  }

  const desiredYMin = Math.max(-WEB_MERCATOR_HALF_WORLD_M, yMin - bufferM);
  const desiredYMax = Math.min(WEB_MERCATOR_HALF_WORLD_M, yMax + bufferM);

  const snapped = (cellM: number) => {
    let gridXMin, gridXMax;
    if (isGlobalX) {
      const columns = Math.max(
        1,
        Math.ceil(WEB_MERCATOR_WORLD_WIDTH_M / cellM)
      );
      cellM = WEB_MERCATOR_WORLD_WIDTH_M / columns;
      gridXMin = -WEB_MERCATOR_HALF_WORLD_M;
      gridXMax = WEB_MERCATOR_HALF_WORLD_M;
    } else {
      gridXMin = Math.floor(desiredXMin / cellM) * cellM;
      gridXMax = Math.ceil(desiredXMax / cellM) * cellM;
    }

    const gridYMin = Math.max(
      -WEB_MERCATOR_HALF_WORLD_M,
      Math.floor(desiredYMin / cellM) * cellM
    );
    const gridYMax = Math.min(
      WEB_MERCATOR_HALF_WORLD_M,
      Math.ceil(desiredYMax / cellM) * cellM
    );

    const columns = Math.max(1, Math.round((gridXMax - gridXMin) / cellM));
    const rows = Math.max(1, Math.round((gridYMax - gridYMin) / cellM));

    return {gridXMin, gridYMin, gridXMax, gridYMax, columns, rows, cellM};
  };

  const initial = snapped(requestedCellM);
  const reduction = Math.max(
    1.0,
    initial.columns / maximumCellsPerAxis,
    initial.rows / maximumCellsPerAxis
  );
  const effectiveCellM = requestedCellM * reduction;

  const final = snapped(effectiveCellM);

  return {
    xMinM: final.gridXMin,
    yMinM: final.gridYMin,
    xMaxM: final.gridXMax,
    yMaxM: final.gridYMax,
    nx: final.columns + 1,
    ny: final.rows + 1,
    viewResolutionMPerPx: resolution,
    cellXM: final.cellM,
    cellYM: final.cellM,
  };
}
