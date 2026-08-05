export function* tableSelectionRange(
  startPosition: number,
  endPosition: number,
  rowCount: number,
  visibleIndices: Uint32Array | null
): Generator<number> {
  const count = visibleIndices?.length ?? rowCount
  const first = Math.max(0, Math.min(startPosition, endPosition))
  const last = Math.min(count - 1, Math.max(startPosition, endPosition))
  for (let position = first; position <= last; position += 1) {
    yield visibleIndices ? visibleIndices[position] : position
  }
}

/**
 * Locates a stable source row in a presentation-order index. Sorting may move
 * the row, but it must never rewrite or reinterpret selection membership.
 */
export function sourceIndexPosition(
  order: Uint32Array,
  sourceIndex: number
): number {
  if (sourceIndex < 0) return -1
  for (let position = 0; position < order.length; position += 1) {
    if (order[position] === sourceIndex) return position
  }
  return -1
}
