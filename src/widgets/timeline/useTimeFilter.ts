export type TimeFilterRange = [number, number]

export function clampTimeFilterRange(
  range: TimeFilterRange,
  minimum: number,
  maximum: number
): TimeFilterRange {
  const start = Math.max(minimum, Math.min(maximum, range[0]))
  const end = Math.max(start, Math.max(minimum, Math.min(maximum, range[1])))
  return [start, end]
}
