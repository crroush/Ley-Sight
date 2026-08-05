export const WEB_MERCATOR_HALF_WORLD = 20_037_508.342789244
export const WEB_MERCATOR_WORLD = WEB_MERCATOR_HALF_WORLD * 2

const LEAF_CAPACITY = 32
const MAX_DEPTH = 18

export type Extent = [number, number, number, number]

export type QuadtreeNode = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  depth: number
  visibleCount: number
  firstIndex: number
  items: number[]
  children: QuadtreeNode[] | null
}

export type PointAccessor = {
  x(index: number): number
  y(index: number): number
  isVisible(index: number): boolean
}

export function projectLonLat(
  longitude: number,
  rawLatitude: number
): [number, number] | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(rawLatitude)) return null
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, rawLatitude))
  const wrappedLongitude = ((((longitude + 180) % 360) + 360) % 360) - 180
  const normalizedLongitude =
    wrappedLongitude === -180 && longitude > 0 ? 180 : wrappedLongitude
  const x = normalizedLongitude * (WEB_MERCATOR_HALF_WORLD / 180)
  const y =
    Math.log(Math.tan(((90 + latitude) * Math.PI) / 360)) *
    (WEB_MERCATOR_HALF_WORLD / Math.PI)
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

export function inverseMercatorLatitude(y: number): number {
  return Math.atan(Math.sinh(y / 6_378_137))
}

export function createRoot(): QuadtreeNode {
  return createNode(
    -WEB_MERCATOR_HALF_WORLD,
    -WEB_MERCATOR_HALF_WORLD,
    WEB_MERCATOR_HALF_WORLD,
    WEB_MERCATOR_HALF_WORLD,
    0
  )
}

function createNode(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  depth: number
): QuadtreeNode {
  return {
    minX,
    minY,
    maxX,
    maxY,
    depth,
    visibleCount: 0,
    firstIndex: -1,
    items: [],
    children: null,
  }
}

function childSlot(node: QuadtreeNode, x: number, y: number): number {
  const midX = (node.minX + node.maxX) * 0.5
  const midY = (node.minY + node.maxY) * 0.5
  return (x >= midX ? 1 : 0) + (y >= midY ? 2 : 0)
}

function makeChildren(node: QuadtreeNode): QuadtreeNode[] {
  if (node.children) return node.children
  const midX = (node.minX + node.maxX) * 0.5
  const midY = (node.minY + node.maxY) * 0.5
  const depth = node.depth + 1
  node.children = [
    createNode(node.minX, node.minY, midX, midY, depth),
    createNode(midX, node.minY, node.maxX, midY, depth),
    createNode(node.minX, midY, midX, node.maxY, depth),
    createNode(midX, midY, node.maxX, node.maxY, depth),
  ]
  return node.children
}

function insertNode(
  node: QuadtreeNode,
  index: number,
  accessor: PointAccessor
): void {
  node.visibleCount += accessor.isVisible(index) ? 1 : 0
  if (node.firstIndex < 0) node.firstIndex = index
  if (node.children) {
    const slot = childSlot(node, accessor.x(index), accessor.y(index))
    insertNode(node.children[slot], index, accessor)
    return
  }
  if (node.items.length < LEAF_CAPACITY || node.depth >= MAX_DEPTH) {
    node.items.push(index)
    return
  }
  const existing = node.items
  node.items = []
  const children = makeChildren(node)
  for (const oldIndex of existing) {
    insertNode(
      children[childSlot(node, accessor.x(oldIndex), accessor.y(oldIndex))],
      oldIndex,
      accessor
    )
  }
  insertNode(
    children[childSlot(node, accessor.x(index), accessor.y(index))],
    index,
    accessor
  )
}

export function insert(
  root: QuadtreeNode,
  index: number,
  accessor: PointAccessor
): void {
  insertNode(root, index, accessor)
}

export function rebuildVisibility(
  node: QuadtreeNode,
  accessor: PointAccessor
): number {
  if (node.children) {
    let total = 0
    for (const child of node.children)
      total += rebuildVisibility(child, accessor)
    node.visibleCount = total
    return total
  }
  let total = 0
  for (const index of node.items) total += accessor.isVisible(index) ? 1 : 0
  node.visibleCount = total
  return total
}

export function intersects(node: QuadtreeNode, extent: Extent): boolean {
  return !(
    node.maxX < extent[0] ||
    node.minX > extent[2] ||
    node.maxY < extent[1] ||
    node.minY > extent[3]
  )
}

export function pointInExtent(
  accessor: PointAccessor,
  index: number,
  extent: Extent
): boolean {
  const x = accessor.x(index)
  const y = accessor.y(index)
  return x >= extent[0] && x <= extent[2] && y >= extent[1] && y <= extent[3]
}

export function wrapXForExtent(x: number, extent: Extent): number {
  const centerX = (extent[0] + extent[2]) * 0.5
  return x + Math.round((centerX - x) / WEB_MERCATOR_WORLD) * WEB_MERCATOR_WORLD
}

export function renderQueryExtents(extent: Extent): Extent[] {
  const centerX = (extent[0] + extent[2]) * 0.5
  const shift = Math.round(centerX / WEB_MERCATOR_WORLD) * WEB_MERCATOR_WORLD
  const minX = extent[0] - shift
  const maxX = extent[2] - shift
  if (minX < -WEB_MERCATOR_HALF_WORLD) {
    return [
      [
        minX + WEB_MERCATOR_WORLD,
        extent[1],
        WEB_MERCATOR_HALF_WORLD,
        extent[3],
      ],
      [-WEB_MERCATOR_HALF_WORLD, extent[1], maxX, extent[3]],
    ]
  }
  if (maxX > WEB_MERCATOR_HALF_WORLD) {
    return [
      [minX, extent[1], WEB_MERCATOR_HALF_WORLD, extent[3]],
      [
        -WEB_MERCATOR_HALF_WORLD,
        extent[1],
        maxX - WEB_MERCATOR_WORLD,
        extent[3],
      ],
    ]
  }
  return [[minX, extent[1], maxX, extent[3]]]
}

export function nearestPoint(
  root: QuadtreeNode,
  accessor: PointAccessor,
  coordinate: [number, number],
  radius: number
): number {
  const extent: Extent = [
    coordinate[0] - radius,
    coordinate[1] - radius,
    coordinate[0] + radius,
    coordinate[1] + radius,
  ]
  let best = -1
  let bestDistance = radius * radius
  for (const queryExtent of renderQueryExtents(extent)) {
    const stack = [root]
    while (stack.length) {
      const node = stack.pop()!
      if (node.visibleCount <= 0 || !intersects(node, queryExtent)) continue
      if (node.children) {
        stack.push(...node.children)
        continue
      }
      for (const index of node.items) {
        if (!accessor.isVisible(index)) continue
        const x = wrapXForExtent(accessor.x(index), extent)
        const dx = x - coordinate[0]
        const dy = accessor.y(index) - coordinate[1]
        const distance = dx * dx + dy * dy
        if (distance <= bestDistance) {
          best = index
          bestDistance = distance
        }
      }
    }
  }
  return best
}
