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
  if (fraction === 1) return end;

  const cosine = clamp(dot(start, end), -1, 1);
  const tangent = [
    end[0] - cosine * start[0],
    end[1] - cosine * start[1],
    end[2] - cosine * start[2],
  ];
  const tangentLength = Math.hypot(...tangent);

  // Antipodal points do not define a unique great-circle plane. Pick one
  // deterministically so the arc remains dense instead of collapsing into a
  // half-world jump. Coincident points, on the other hand, need no arc.
  if (tangentLength < 1e-12) {
    if (cosine > 0) return start;
    tangent.splice(0, 3, ...orthogonal(start));
  } else {
    for (let index = 0; index < tangent.length; index += 1)
      tangent[index] /= tangentLength;
  }

  const alongStart = Math.cos(fraction * angle);
  const alongTangent = Math.sin(fraction * angle);
  return [
    start[0] * alongStart + tangent[0] * alongTangent,
    start[1] * alongStart + tangent[1] * alongTangent,
    start[2] * alongStart + tangent[2] * alongTangent,
  ];
}

function orthogonal(vector: Coordinate): Coordinate {
  const axis = [0, 0, 0];
  const leastAligned = vector
    .map(Math.abs)
    .indexOf(Math.min(...vector.map(Math.abs)));
  axis[leastAligned] = 1;
  const projection = dot(axis, vector);
  const tangent = axis.map(
    (component, index) => component - projection * vector[index]
  );
  const length = Math.hypot(...tangent);
  return tangent.map((component) => component / length);
}

function dot(left: Coordinate, right: Coordinate): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
