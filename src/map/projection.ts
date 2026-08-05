import { WEB_MERCATOR_HALF_WORLD } from './quadtree'

export const WEB_MERCATOR_MAX_LATITUDE = 85.05112878

export type CoordinateValidation =
  | { status: 'invalid'; reason: 'non-finite' | 'longitude' | 'latitude' }
  | {
      status: 'projectable'
      longitude: number
      latitude: number
      displayLatitude: number
      projectionClamped: boolean
      projected: [number, number]
    }

/** Validate source coordinates without wrapping them, then prepare Web Mercator display coordinates. */
export function validateCoordinate(
  longitude: number,
  latitude: number
): CoordinateValidation {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return { status: 'invalid', reason: 'non-finite' }
  }
  if (longitude < -180 || longitude > 180) {
    return { status: 'invalid', reason: 'longitude' }
  }
  if (latitude < -90 || latitude > 90) {
    return { status: 'invalid', reason: 'latitude' }
  }
  const displayLatitude = Math.max(
    -WEB_MERCATOR_MAX_LATITUDE,
    Math.min(WEB_MERCATOR_MAX_LATITUDE, latitude)
  )
  return {
    status: 'projectable',
    longitude,
    latitude,
    displayLatitude,
    projectionClamped: displayLatitude !== latitude,
    projected: [projectLongitude(longitude), projectLatitude(displayLatitude)],
  }
}

export function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) return Number.NaN
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180
  return normalized === -180 && longitude > 0 ? 180 : normalized
}

export function projectLongitude(longitude: number): number {
  return normalizeLongitude(longitude) * (WEB_MERCATOR_HALF_WORLD / 180)
}

export function projectLatitude(rawLatitude: number): number {
  const latitude = Math.max(
    -WEB_MERCATOR_MAX_LATITUDE,
    Math.min(WEB_MERCATOR_MAX_LATITUDE, rawLatitude)
  )
  return (
    Math.log(Math.tan(((90 + latitude) * Math.PI) / 360)) *
    (WEB_MERCATOR_HALF_WORLD / Math.PI)
  )
}

export function projectLonLatExact(
  longitude: number,
  latitude: number
): [number, number] | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  const x = projectLongitude(longitude)
  const y = projectLatitude(latitude)
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}
