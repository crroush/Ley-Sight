import type { TimestampInterpretation } from './types'

/** JavaScript Date's inclusive range, expressed in Unix seconds. */
export const MIN_TIMESTAMP_SECONDS = -8_640_000_000_000
export const MAX_TIMESTAMP_SECONDS = 8_640_000_000_000

const NUMERIC_UNITS: Exclude<TimestampInterpretation, 'automatic' | 'iso'>[] = [
  'unix-seconds',
  'unix-milliseconds',
  'unix-microseconds',
  'unix-nanoseconds',
  'excel-serial',
]

function numericSeconds(
  text: string,
  unit: (typeof NUMERIC_UNITS)[number]
): number {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return Number.NaN
  const value = Number(text)
  if (!Number.isFinite(value)) return Number.NaN
  switch (unit) {
    case 'unix-seconds':
      return value
    case 'unix-milliseconds':
      return value / 1_000
    case 'unix-microseconds':
      return value / 1_000_000
    case 'unix-nanoseconds':
      return value / 1_000_000_000
    case 'excel-serial':
      return (value - 25_569) * 86_400
  }
}

function automaticUnit(text: string): (typeof NUMERIC_UNITS)[number] {
  const magnitude = Math.abs(Number(text))
  if (magnitude >= 100_000_000_000_000_000) return 'unix-nanoseconds'
  if (magnitude >= 100_000_000_000_000) return 'unix-microseconds'
  if (magnitude >= 100_000_000_000) return 'unix-milliseconds'
  return 'unix-seconds'
}

// Date-only and zone-less ISO values are deliberately UTC, never local time.
function isoSeconds(text: string): number {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      text
    )
  if (!match) return Number.NaN
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText = '0',
    minuteText = '0',
    secondText = '0',
    fraction = '',
    zone = 'Z',
  ] = match
  const year = Number(yearText),
    month = Number(monthText),
    day = Number(dayText)
  const hour = Number(hourText),
    minute = Number(minuteText),
    second = Number(secondText)
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return Number.NaN
  // Date.UTC treats years 0–99 as 1900–1999. setUTCFullYear preserves the
  // literal ISO year, including year 0000, without relying on that legacy rule.
  const check = new Date(0)
  check.setUTCHours(hour, minute, second, 0)
  check.setUTCFullYear(year, month - 1, day)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return Number.NaN
  const localSeconds = check.getTime() / 1000 + Number(`0.${fraction}`)
  let offsetMillis = 0
  if (zone !== 'Z') {
    const sign = zone[0] === '+' ? 1 : -1
    const digits = zone.slice(1).replace(':', '')
    const offsetHours = Number(digits.slice(0, 2)),
      offsetMinutes = Number(digits.slice(2))
    if (offsetHours > 23 || offsetMinutes > 59) return Number.NaN
    offsetMillis = sign * (offsetHours * 60 + offsetMinutes) * 60_000
  }
  return localSeconds - offsetMillis / 1000
}

export function parseTimestamp(
  value: unknown,
  interpretation: TimestampInterpretation = 'automatic'
): number {
  if (value == null) return Number.NaN
  const text = String(value).trim()
  if (!text) return Number.NaN
  let seconds: number
  if (interpretation === 'iso') seconds = isoSeconds(text)
  else if (interpretation === 'automatic') {
    seconds = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)
      ? numericSeconds(text, automaticUnit(text))
      : isoSeconds(text)
  } else seconds = numericSeconds(text, interpretation)
  return Number.isFinite(seconds) &&
    seconds >= MIN_TIMESTAMP_SECONDS &&
    seconds <= MAX_TIMESTAMP_SECONDS
    ? seconds
    : Number.NaN
}

export function formatTimestampPreview(seconds: number): string {
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : 'Invalid timestamp'
}
