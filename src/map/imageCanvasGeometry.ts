import type { Extent } from "./quadtree";

export function imageCanvasPixelSize(
  size: [number, number],
): [number, number] {
  return [
    Math.max(1, Math.floor(size[0])),
    Math.max(1, Math.floor(size[1])),
  ];
}

export function coordinateToImagePixel(
  coordinate: [number, number],
  extent: Extent,
  canvasSize: [number, number],
): [number, number] {
  return [
    ((coordinate[0] - extent[0]) / (extent[2] - extent[0])) * canvasSize[0],
    ((extent[3] - coordinate[1]) / (extent[3] - extent[1])) * canvasSize[1],
  ];
}
