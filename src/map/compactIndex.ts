import type { CompactSpatialIndex } from '../lib/types'
import { WEB_MERCATOR_HALF_WORLD, WEB_MERCATOR_WORLD } from './quadtree'

const MORTON_BITS = 18
const MORTON_GRID_SIZE = 2 ** MORTON_BITS
const DEFAULT_LEAF_CAPACITY = 32

function coordinateCell(value: number): number {
  const normalized =
    ((value + WEB_MERCATOR_HALF_WORLD) / WEB_MERCATOR_WORLD) * MORTON_GRID_SIZE
  return Math.max(0, Math.min(MORTON_GRID_SIZE - 1, Math.floor(normalized)))
}

export function mortonCode(x: number, y: number): number {
  const xCell = coordinateCell(x)
  const yCell = coordinateCell(y)
  let code = 0
  for (let bit = MORTON_BITS - 1; bit >= 0; bit -= 1) {
    code = code * 4 + ((xCell >>> bit) & 1) + ((yCell >>> bit) & 1) * 2
  }
  return code
}

function radixSort(
  codes: Float64Array<ArrayBuffer>,
  order: Uint32Array<ArrayBuffer>
): void {
  const scratchCodes = new Float64Array(codes.length)
  const scratchOrder = new Uint32Array(order.length)
  const counts = new Uint32Array(512)
  let sourceCodes = codes
  let sourceOrder = order
  let targetCodes = scratchCodes
  let targetOrder = scratchOrder

  for (const shift of [0, 9, 18, 27]) {
    const divisor = 2 ** shift
    counts.fill(0)
    for (let index = 0; index < sourceCodes.length; index += 1) {
      counts[Math.floor(sourceCodes[index] / divisor) % 512] += 1
    }
    let offset = 0
    for (let digit = 0; digit < counts.length; digit += 1) {
      const count = counts[digit]
      counts[digit] = offset
      offset += count
    }
    for (let index = 0; index < sourceCodes.length; index += 1) {
      const digit = Math.floor(sourceCodes[index] / divisor) % 512
      const destination = counts[digit]++
      targetCodes[destination] = sourceCodes[index]
      targetOrder[destination] = sourceOrder[index]
    }
    ;[sourceCodes, targetCodes] = [targetCodes, sourceCodes]
    ;[sourceOrder, targetOrder] = [targetOrder, sourceOrder]
  }
}

function lowerBound(
  values: Float64Array<ArrayBuffer>,
  start: number,
  end: number,
  target: number
): number {
  let low = start
  let high = end
  while (low < high) {
    const middle = low + ((high - low) >>> 1)
    if (values[middle] < target) low = middle + 1
    else high = middle
  }
  return low
}

type PendingNode = {
  id: number
  depth: number
  prefix: number
}

export function buildCompactSpatialIndex(
  x: Float64Array<ArrayBuffer>,
  y: Float64Array<ArrayBuffer>,
  leafCapacity = DEFAULT_LEAF_CAPACITY
): CompactSpatialIndex {
  if (x.length !== y.length) {
    throw new Error('Spatial coordinate arrays must have the same length.')
  }
  const count = x.length
  const codes = new Float64Array(count)
  const order = new Uint32Array(count)
  for (let index = 0; index < count; index += 1) {
    codes[index] = mortonCode(x[index], y[index])
    order[index] = index
  }
  radixSort(codes, order)

  const starts: number[] = []
  const ends: number[] = []
  const children: number[] = []
  const minXs: number[] = []
  const minYs: number[] = []
  const maxXs: number[] = []
  const maxYs: number[] = []

  const addNode = (
    start: number,
    end: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): number => {
    const id = starts.length
    starts.push(start)
    ends.push(end)
    children.push(-1, -1, -1, -1)
    minXs.push(minX)
    minYs.push(minY)
    maxXs.push(maxX)
    maxYs.push(maxY)
    return id
  }

  const root = addNode(
    0,
    count,
    -WEB_MERCATOR_HALF_WORLD,
    -WEB_MERCATOR_HALF_WORLD,
    WEB_MERCATOR_HALF_WORLD,
    WEB_MERCATOR_HALF_WORLD
  )
  const pending: PendingNode[] = [{ id: root, depth: 0, prefix: 0 }]
  while (pending.length) {
    const current = pending.pop()!
    const start = starts[current.id]
    const end = ends[current.id]
    if (end - start <= leafCapacity || current.depth >= MORTON_BITS) {
      continue
    }

    const shift = (MORTON_BITS - current.depth - 1) * 2
    const childSpan = 2 ** shift
    const boundaries = [
      start,
      lowerBound(codes, start, end, current.prefix + childSpan),
      lowerBound(codes, start, end, current.prefix + childSpan * 2),
      lowerBound(codes, start, end, current.prefix + childSpan * 3),
      end,
    ]
    const minX = minXs[current.id]
    const minY = minYs[current.id]
    const maxX = maxXs[current.id]
    const maxY = maxYs[current.id]
    const midX = (minX + maxX) * 0.5
    const midY = (minY + maxY) * 0.5
    for (let slot = 0; slot < 4; slot += 1) {
      if (boundaries[slot] === boundaries[slot + 1]) continue
      const childMinX = slot & 1 ? midX : minX
      const childMaxX = slot & 1 ? maxX : midX
      const childMinY = slot & 2 ? midY : minY
      const childMaxY = slot & 2 ? maxY : midY
      const child = addNode(
        boundaries[slot],
        boundaries[slot + 1],
        childMinX,
        childMinY,
        childMaxX,
        childMaxY
      )
      children[current.id * 4 + slot] = child
      pending.push({
        id: child,
        depth: current.depth + 1,
        prefix: current.prefix + slot * childSpan,
      })
    }
  }

  const nodeStart = Uint32Array.from(starts)
  const nodeEnd = Uint32Array.from(ends)
  const nodeChildren = Int32Array.from(children)
  const nodeFirstIndex = new Uint32Array(starts.length)
  nodeFirstIndex.fill(0xffffffff)
  for (let node = starts.length - 1; node >= 0; node -= 1) {
    let hasChildren = false
    let firstIndex = 0xffffffff
    for (let slot = 0; slot < 4; slot += 1) {
      const child = nodeChildren[node * 4 + slot]
      if (child < 0) continue
      hasChildren = true
      firstIndex = Math.min(firstIndex, nodeFirstIndex[child])
    }
    if (!hasChildren) {
      order.subarray(nodeStart[node], nodeEnd[node]).sort()
      if (nodeEnd[node] > nodeStart[node]) {
        firstIndex = order[nodeStart[node]]
      }
    }
    nodeFirstIndex[node] = firstIndex
  }

  return {
    order,
    nodeStart,
    nodeEnd,
    nodeFirstIndex,
    nodeChildren,
    nodeMinX: Float64Array.from(minXs),
    nodeMinY: Float64Array.from(minYs),
    nodeMaxX: Float64Array.from(maxXs),
    nodeMaxY: Float64Array.from(maxYs),
  }
}

export function compactIndexBytes(index: CompactSpatialIndex): number {
  return (
    index.order.byteLength +
    index.nodeStart.byteLength +
    index.nodeEnd.byteLength +
    index.nodeFirstIndex.byteLength +
    index.nodeChildren.byteLength +
    index.nodeMinX.byteLength +
    index.nodeMinY.byteLength +
    index.nodeMaxX.byteLength +
    index.nodeMaxY.byteLength
  )
}
