import type {Coordinate} from 'ol/coordinate.js';
import LineString from 'ol/geom/LineString.js';
import {fromLonLat, toLonLat} from 'ol/proj.js';

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6_378_137;
const MIN_ANGLE_RADIANS = Math.PI / 180;
const MAX_ANGLE_RADIANS = Math.PI / 6;
const TARGET_SEGMENT_PIXELS = 16;

/** Builds a projected polyline following the shortest great-circle arcs. */
export function geodesicLine(
  controls: Coordinate[],
  geometry?: LineString,
  resolution = 1
): LineString {
  const line = geometry ?? new LineString([]);
  if (controls.length < 2) {
    line.setCoordinates(controls);
    return line;
  }

  // OpenLayers resolution is projected map units per CSS pixel. Sampling from
  // it avoids creating hundreds of sub-pixel vertices at whole-world zooms.
  const maxAngleRadians = clamp(
    (resolution * TARGET_SEGMENT_PIXELS) / 6_378_137,
    MIN_ANGLE_RADIANS,
    MAX_ANGLE_RADIANS
  );
  const result: Coordinate[] = [controls[0].slice()];
  let previousX = result[0][0];
  for (let index = 1; index < controls.length; index += 1) {
    const start = lonLatVector(toLonLat(controls[index - 1]));
    const end = lonLatVector(toLonLat(controls[index]));
    const angle = Math.acos(clamp(dot(start, end), -1, 1));
    const steps = Math.max(1, Math.ceil(angle / maxAngleRadians));
    for (let step = 1; step <= steps; step += 1) {
      const vector = interpolate(start, end, angle, step / steps);
      const projected = fromLonLat([
        (Math.atan2(vector[1], vector[0]) * 180) / Math.PI,
        (Math.atan2(vector[2], Math.hypot(vector[0], vector[1])) * 180) /
          Math.PI,
      ]);
      // Avoid drawing nearly around the world when an arc crosses the dateline.
      while (projected[0] - previousX > EARTH_CIRCUMFERENCE_M / 2)
        projected[0] -= EARTH_CIRCUMFERENCE_M;
      while (projected[0] - previousX < -EARTH_CIRCUMFERENCE_M / 2)
        projected[0] += EARTH_CIRCUMFERENCE_M;
      result.push(projected);
      previousX = projected[0];
    }
  }
  line.setCoordinates(result);
  return line;
}

function lonLatVector([longitude, latitude]: Coordinate): Coordinate {
  const lon = (longitude * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

function interpolate(
  start: Coordinate,
  end: Coordinate,
  angle: number,
  fraction: number
): Coordinate {
  const sinAngle = Math.sin(angle);
  if (Math.abs(sinAngle) < 1e-12) return fraction < 0.5 ? start : end;
  const a = Math.sin((1 - fraction) * angle) / sinAngle;
  const b = Math.sin(fraction * angle) / sinAngle;
  return [
    start[0] * a + end[0] * b,
    start[1] * a + end[1] * b,
    start[2] * a + end[2] * b,
  ];
}

function dot(left: Coordinate, right: Coordinate): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
