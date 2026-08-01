export type MaskShape =
  | "rectangle"
  | "circle"
  | "triangle"
  | "hexagon"
  | "star"
  | "irregular";

export type PixelPoint = readonly [number, number];

function regularPolygon(
  width: number,
  height: number,
  pointCount: number,
  startingAngle: number,
): PixelPoint[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.4;
  return Array.from({length: pointCount}, (_, index) => {
    const angle =
      (2 * Math.PI * index) / pointCount + startingAngle;
    return [
      centerX + radius * Math.cos(angle),
      centerY + radius * Math.sin(angle),
    ];
  });
}

/**
 * Returns the same pixel-space polygons as Qt example 05. A null polygon is
 * the example's unmasked full rectangle.
 */
export function polygonForMask(
  mask: MaskShape,
  width: number,
  height: number,
): PixelPoint[] | null {
  if (mask === "rectangle") return null;
  if (mask === "circle") {
    return regularPolygon(width, height, 50, 0);
  }
  if (mask === "triangle") {
    return regularPolygon(width, height, 3, -Math.PI / 2);
  }
  if (mask === "hexagon") {
    return regularPolygon(width, height, 6, 0);
  }
  if (mask === "star") {
    const centerX = width / 2;
    const centerY = height / 2;
    const outerRadius = Math.min(width, height) * 0.4;
    const innerRadius = outerRadius * 0.4;
    return Array.from({length: 10}, (_, index) => {
      const angle = (2 * Math.PI * index) / 10 - Math.PI / 2;
      const radius = index % 2 === 0 ? outerRadius : innerRadius;
      return [
        centerX + radius * Math.cos(angle),
        centerY + radius * Math.sin(angle),
      ];
    });
  }
  const percentages: PixelPoint[] = [
    [0.2, 0.3],
    [0.4, 0.2],
    [0.7, 0.3],
    [0.8, 0.5],
    [0.7, 0.7],
    [0.5, 0.8],
    [0.3, 0.7],
    [0.1, 0.5],
  ];
  return percentages.map(([x, y]) => [x * width, y * height]);
}

export function insidePolygon(
  x: number,
  y: number,
  polygon: readonly PixelPoint[],
): boolean {
  let inside = false;
  for (
    let first = 0, second = polygon.length - 1;
    first < polygon.length;
    second = first++
  ) {
    const [firstX, firstY] = polygon[first];
    const [secondX, secondY] = polygon[second];
    const crosses =
      firstY > y !== secondY > y &&
      x <
        ((secondX - firstX) * (y - firstY)) /
          (secondY - firstY) +
          firstX;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function insideMask(
  x: number,
  y: number,
  width: number,
  height: number,
  mask: MaskShape,
  polygon: readonly PixelPoint[] | null,
): boolean {
  if (mask === "rectangle") return true;
  if (mask === "circle") {
    if (polygon) return insidePolygon(x, y, polygon);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.4;
    const deltaX = x - centerX;
    const deltaY = y - centerY;
    return deltaX * deltaX + deltaY * deltaY <= radius * radius;
  }
  return polygon ? insidePolygon(x, y, polygon) : false;
}
