import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildCompactSpatialIndex } from './compactIndex'
import {
  WEB_MERCATOR_HALF_WORLD,
  WEB_MERCATOR_WORLD,
  createRoot,
  insert,
  intersects,
  pointInExtent,
  type Extent,
  type PointAccessor,
  type QuadtreeNode,
} from './quadtree'

function objectRepresentative(
  node: QuadtreeNode,
  accessor: PointAccessor,
  extent: Extent
): number {
  if (node.visibleCount <= 0) return -1
  if (
    node.firstIndex >= 0 &&
    pointInExtent(accessor, node.firstIndex, extent)
  ) {
    return node.firstIndex
  }
  if (node.children) {
    for (const child of node.children) {
      if (!intersects(child, extent)) continue
      const result = objectRepresentative(child, accessor, extent)
      if (result >= 0) return result
    }
    return -1
  }
  for (const index of node.items) {
    if (pointInExtent(accessor, index, extent)) return index
  }
  return -1
}

describe('compact/original quadtree render parity', () => {
  it('returns the same source-row candidates at multiple resolutions', () => {
    const count = 50_000
    const x = new Float64Array(count)
    const y = new Float64Array(count)
    let state = 0x51a7cafe
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state / 4_294_967_296
    }
    for (let index = 0; index < count; index += 1) {
      x[index] = (random() * 2 - 1) * WEB_MERCATOR_HALF_WORLD
      y[index] = (random() * 2 - 1) * WEB_MERCATOR_HALF_WORLD
    }
    const accessor: PointAccessor = {
      x: (index) => x[index],
      y: (index) => y[index],
      isVisible: () => true,
    }
    const original = createRoot()
    for (let index = 0; index < count; index += 1) {
      insert(original, index, accessor)
    }
    const compact = buildCompactSpatialIndex(x, y)
    const extent: Extent = [
      -WEB_MERCATOR_HALF_WORLD * 0.74,
      -WEB_MERCATOR_HALF_WORLD * 0.61,
      WEB_MERCATOR_HALF_WORLD * 0.68,
      WEB_MERCATOR_HALF_WORLD * 0.79,
    ]

    const compactIntersects = (node: number): boolean =>
      !(
        compact.nodeMaxX[node] < extent[0] ||
        compact.nodeMinX[node] > extent[2] ||
        compact.nodeMaxY[node] < extent[1] ||
        compact.nodeMinY[node] > extent[3]
      )
    const compactLeaf = (node: number): boolean =>
      compact.nodeChildren[node * 4] < 0 &&
      compact.nodeChildren[node * 4 + 1] < 0 &&
      compact.nodeChildren[node * 4 + 2] < 0 &&
      compact.nodeChildren[node * 4 + 3] < 0
    const compactRepresentative = (node: number): number => {
      const first = compact.nodeFirstIndex[node]
      if (
        first !== 0xffffffff &&
        x[first] >= extent[0] &&
        x[first] <= extent[2] &&
        y[first] >= extent[1] &&
        y[first] <= extent[3]
      ) {
        return first
      }
      if (!compactLeaf(node)) {
        for (let slot = 0; slot < 4; slot += 1) {
          const child = compact.nodeChildren[node * 4 + slot]
          if (child < 0 || !compactIntersects(child)) continue
          const result = compactRepresentative(child)
          if (result >= 0) return result
        }
        return -1
      }
      for (
        let offset = compact.nodeStart[node];
        offset < compact.nodeEnd[node];
        offset += 1
      ) {
        const index = compact.order[offset]
        if (
          x[index] >= extent[0] &&
          x[index] <= extent[2] &&
          y[index] >= extent[1] &&
          y[index] <= extent[3]
        ) {
          return index
        }
      }
      return -1
    }

    for (const resolution of [
      WEB_MERCATOR_WORLD / 400,
      WEB_MERCATOR_WORLD / 1_600,
      WEB_MERCATOR_WORLD / 6_400,
    ]) {
      const originalCandidates: number[] = []
      const originalStack = [original]
      while (originalStack.length) {
        const node = originalStack.pop()!
        if (node.visibleCount <= 0 || !intersects(node, extent)) continue
        const width = (node.maxX - node.minX) / resolution
        const height = (node.maxY - node.minY) / resolution
        if (width <= 3 && height <= 3) {
          const representative = objectRepresentative(node, accessor, extent)
          if (representative >= 0) originalCandidates.push(representative)
          continue
        }
        if (node.children) {
          originalStack.push(...node.children)
          continue
        }
        for (const index of node.items) {
          if (pointInExtent(accessor, index, extent)) {
            originalCandidates.push(index)
          }
        }
      }

      const compactCandidates: number[] = []
      const compactStack = [0]
      while (compactStack.length) {
        const node = compactStack.pop()!
        if (!compactIntersects(node)) continue
        const width =
          (compact.nodeMaxX[node] - compact.nodeMinX[node]) / resolution
        const height =
          (compact.nodeMaxY[node] - compact.nodeMinY[node]) / resolution
        if (width <= 3 && height <= 3) {
          const representative = compactRepresentative(node)
          if (representative >= 0) compactCandidates.push(representative)
          continue
        }
        if (!compactLeaf(node)) {
          for (let slot = 0; slot < 4; slot += 1) {
            const child = compact.nodeChildren[node * 4 + slot]
            if (child >= 0) compactStack.push(child)
          }
          continue
        }
        for (
          let offset = compact.nodeStart[node];
          offset < compact.nodeEnd[node];
          offset += 1
        ) {
          const index = compact.order[offset]
          if (
            x[index] >= extent[0] &&
            x[index] <= extent[2] &&
            y[index] >= extent[1] &&
            y[index] <= extent[3]
          ) {
            compactCandidates.push(index)
          }
        }
      }
      assert.deepEqual(compactCandidates, originalCandidates)
    }
  })
})
