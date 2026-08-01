import { WEB_MERCATOR_HALF_WORLD } from "./quadtree";

export function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) return Number.NaN;
  const normalized = ((longitude + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 && longitude > 0 ? 180 : normalized;
}

export function projectLongitude(longitude: number): number {
  return normalizeLongitude(longitude) * (WEB_MERCATOR_HALF_WORLD / 180);
}

export function projectLatitude(rawLatitude: number): number {
  const latitude = Math.max(
    -85.05112878,
    Math.min(85.05112878, rawLatitude),
  );
  return (
    Math.log(Math.tan(((90 + latitude) * Math.PI) / 360)) *
    (WEB_MERCATOR_HALF_WORLD / Math.PI)
  );
}

export function projectLonLatExact(
  longitude: number,
  latitude: number,
): [number, number] | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const x = projectLongitude(longitude);
  const y = projectLatitude(latitude);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}
