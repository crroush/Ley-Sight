import type {CompactSpatialIndex} from '../lib/types';
import type {Extent} from './quadtree';

function isLeaf(spatial: CompactSpatialIndex, node: number): boolean {
  const base = node * 4;
  return (
    spatial.nodeChildren[base] < 0 &&
    spatial.nodeChildren[base + 1] < 0 &&
    spatial.nodeChildren[base + 2] < 0 &&
    spatial.nodeChildren[base + 3] < 0
  );
}

function nodeIntersects(
  spatial: CompactSpatialIndex,
  node: number,
  extent: Extent
): boolean {
  return !(
    spatial.nodeMaxX[node] < extent[0] ||
    spatial.nodeMinX[node] > extent[2] ||
    spatial.nodeMaxY[node] < extent[1] ||
    spatial.nodeMinY[node] > extent[3]
  );
}

function nodeInsideExtent(
  spatial: CompactSpatialIndex,
  node: number,
  extent: Extent
): boolean {
  return (
    spatial.nodeMinX[node] >= extent[0] &&
    spatial.nodeMaxX[node] <= extent[2] &&
    spatial.nodeMinY[node] >= extent[1] &&
    spatial.nodeMaxY[node] <= extent[3]
  );
}

function pointInExtent(
  x: Float64Array,
  y: Float64Array,
  index: number,
  extent: Extent
): boolean {
  return (
    x[index] >= extent[0] &&
    x[index] <= extent[2] &&
    y[index] >= extent[1] &&
    y[index] <= extent[3]
  );
}

export function rebuildNodeSelectionCounts(
  spatial: CompactSpatialIndex,
  selected: Uint8Array,
  visible: Uint8Array,
  deleted: Uint8Array,
  nodeSelected: Uint32Array
): number {
  for (let node = nodeSelected.length - 1; node >= 0; node -= 1) {
    if (!isLeaf(spatial, node)) {
      let total = 0;
      const base = node * 4;
      for (let slot = 0; slot < 4; slot += 1) {
        const child = spatial.nodeChildren[base + slot];
        if (child >= 0) total += nodeSelected[child];
      }
      nodeSelected[node] = total;
      continue;
    }

    let total = 0;
    for (
      let offset = spatial.nodeStart[node];
      offset < spatial.nodeEnd[node];
      offset += 1
    ) {
      const index = spatial.order[offset];
      if (selected[index] && visible[index] && !deleted[index]) {
        total += 1;
      } else if (selected[index]) {
        selected[index] = 0;
      }
    }
    nodeSelected[node] = total;
  }
  return nodeSelected[0] ?? 0;
}

export function selectExtentIntoMask(
  spatial: CompactSpatialIndex,
  x: Float64Array,
  y: Float64Array,
  selected: Uint8Array,
  visible: Uint8Array,
  deleted: Uint8Array,
  nodeVisible: Uint32Array,
  nodeSelected: Uint32Array,
  extent: Extent,
  replace = true
): number {
  if (replace) {
    selected.fill(0);
    nodeSelected.fill(0);
  }
  if (!spatial.nodeStart.length) {
    nodeSelected.fill(0);
    return 0;
  }

  const selectWholeNode = (node: number): number => {
    for (
      let offset = spatial.nodeStart[node];
      offset < spatial.nodeEnd[node];
      offset += 1
    ) {
      const index = spatial.order[offset];
      if (visible[index] && !deleted[index]) selected[index] = 1;
    }
    const stack = [node];
    while (stack.length) {
      const current = stack.pop()!;
      nodeSelected[current] = nodeVisible[current];
      const base = current * 4;
      for (let slot = 0; slot < 4; slot += 1) {
        const child = spatial.nodeChildren[base + slot];
        if (child >= 0) stack.push(child);
      }
    }
    return nodeVisible[node];
  };

  const visitNode = (node: number): number => {
    if (nodeVisible[node] <= 0) {
      nodeSelected[node] = 0;
      return 0;
    }
    if (!nodeIntersects(spatial, node, extent)) {
      if (replace) nodeSelected[node] = 0;
      return nodeSelected[node];
    }
    if (nodeInsideExtent(spatial, node, extent)) {
      return selectWholeNode(node);
    }
    if (isLeaf(spatial, node)) {
      let total = 0;
      for (
        let offset = spatial.nodeStart[node];
        offset < spatial.nodeEnd[node];
        offset += 1
      ) {
        const index = spatial.order[offset];
        if (
          visible[index] &&
          !deleted[index] &&
          pointInExtent(x, y, index, extent)
        ) {
          selected[index] = 1;
        }
        if (selected[index] && visible[index] && !deleted[index]) {
          total += 1;
        }
      }
      nodeSelected[node] = total;
      return total;
    }

    let total = 0;
    const base = node * 4;
    for (let slot = 0; slot < 4; slot += 1) {
      const child = spatial.nodeChildren[base + slot];
      if (child >= 0) total += visitNode(child);
    }
    nodeSelected[node] = total;
    return total;
  };

  return visitNode(0);
}
