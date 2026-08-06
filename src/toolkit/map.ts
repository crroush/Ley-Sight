/** Supported map rendering and spatial-index APIs. */
export {
  FastPointEngine,
  type EllipseRenderStyle,
  type PointRenderStyle,
} from '../map/FastPointEngine';
export {buildCompactSpatialIndex, compactIndexBytes} from '../map/compactIndex';
export {
  normalizeLongitude,
  projectLatitude,
  projectLongitude,
  projectLonLatExact,
  validateCoordinate,
  WEB_MERCATOR_MAX_LATITUDE,
  type CoordinateValidation,
} from '../map/projection';
