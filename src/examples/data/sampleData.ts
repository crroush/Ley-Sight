import Polygon from 'ol/geom/Polygon.js'
import { fromLonLat } from 'ol/proj.js'
import type { DatasetSummary, PackedDataset } from '../../lib/types'
import { buildCompactSpatialIndex } from '../../map/compactIndex'

export type SamplePointRecord = {
  longitude: number
  latitude: number
  time?: number
  semiMajor?: number
  semiMinor?: number
  tilt?: number
  color?: number
}

const PCG64_MULTIPLIER = 47_026_247_687_942_121_848_144_207_491_837_523_525n
const UINT64_MASK = (1n << 64n) - 1n
const UINT128_MASK = (1n << 128n) - 1n

/**
 * NumPy's SeedSequence-derived PCG64 states for the seeds used by the reference
 * examples. Keeping these states in the browser makes every call to
 * `default_rng(seed).random()` byte-for-byte reproducible without shipping
 * generated coordinate fixtures.
 */
const NUMPY_PCG64_STATES = new Map<number, readonly [bigint, bigint]>([
  [
    7,
    [
      208_745_520_555_909_116_978_795_849_195_383_758_904n,
      261_136_684_632_268_670_825_940_853_076_396_136_793n,
    ],
  ],
  [
    17,
    [
      191_425_278_619_858_320_667_688_084_520_535_371_943n,
      78_856_291_631_749_604_729_656_725_519_709_880_197n,
    ],
  ],
  [
    42,
    [
      274_674_114_334_540_486_603_088_602_300_644_985_544n,
      332_724_090_758_049_132_448_979_897_138_935_081_983n,
    ],
  ],
  [
    43,
    [
      82_603_460_112_531_164_776_355_945_615_041_298_124n,
      25_065_611_243_303_971_628_957_076_795_638_243_391n,
    ],
  ],
])

export type SeededRandomGenerator = {
  random: () => number
  integer: (minimum: number, maximumExclusive: number) => number
}

/**
 * Creates the PCG64 stream used by NumPy's default_rng.
 *
 * NumPy's bounded small-integer path consumes buffered 32-bit halves from the
 * same 64-bit PCG64 stream. Preserving that buffer is necessary for examples
 * that interleave random coordinate arrays with `rng.integers(...)`.
 */
export function createSeededRandomGenerator(seed = 42): SeededRandomGenerator {
  const initial = NUMPY_PCG64_STATES.get(seed)
  if (!initial) {
    throw new Error(`No NumPy PCG64 state is registered for seed ${seed}.`)
  }
  let [state, increment] = initial
  let bufferedUint32: number | null = null
  const nextRaw = (): bigint => {
    state = (state * PCG64_MULTIPLIER + increment) & UINT128_MASK
    const high = state >> 64n
    const low = state & UINT64_MASK
    const xorshifted = (high ^ low) & UINT64_MASK
    const rotation = Number(state >> 122n) & 63
    const value =
      ((xorshifted >> BigInt(rotation)) |
        (xorshifted << BigInt(-rotation & 63))) &
      UINT64_MASK
    return value
  }

  const nextUint32 = (): number => {
    if (bufferedUint32 != null) {
      const value = bufferedUint32
      bufferedUint32 = null
      return value
    }
    const raw = nextRaw()
    bufferedUint32 = Number((raw >> 32n) & 0xffff_ffffn)
    return Number(raw & 0xffff_ffffn)
  }

  return {
    random: () => Number(nextRaw() >> 11n) / 9_007_199_254_740_992,
    integer: (minimum, maximumExclusive) => {
      if (
        !Number.isSafeInteger(minimum) ||
        !Number.isSafeInteger(maximumExclusive) ||
        maximumExclusive <= minimum
      ) {
        throw new Error('integer bounds must be safe integers with max > min')
      }
      const range = maximumExclusive - minimum
      if (range > 0x1_0000_0000) {
        throw new Error('integer ranges larger than uint32 are unsupported')
      }
      const rangeBigInt = BigInt(range)
      // Lemire's unbiased bounded-uint32 method, matching NumPy.
      const threshold = Number((1n << 32n) % rangeBigInt)
      while (true) {
        const product = BigInt(nextUint32()) * rangeBigInt
        const lower = Number(product & 0xffff_ffffn)
        if (lower >= threshold) {
          return minimum + Number(product >> 32n)
        }
      }
    },
  }
}

/**
 * Returns the same IEEE-754 doubles as
 * `np.random.default_rng(seed).random()`.
 */
export function createSeededRandom(seed = 42): () => number {
  return createSeededRandomGenerator(seed).random
}

export function packRgba(
  red: number,
  green: number,
  blue: number,
  alpha = 255
): number {
  return (
    (((red & 255) << 24) |
      ((green & 255) << 16) |
      ((blue & 255) << 8) |
      (alpha & 255)) >>>
    0
  )
}

export function createSampleDataset(
  name: string,
  records: readonly SamplePointRecord[]
): { dataset: PackedDataset; summary: DatasetSummary } {
  const count = records.length
  const x = new Float64Array(count)
  const y = new Float64Array(count)
  const semiMajor = new Float32Array(count)
  const semiMinor = new Float32Array(count)
  const rotation = new Float32Array(count)
  const time = new Float64Array(count)
  const colors = new Uint32Array(count)
  const extent: [number, number, number, number] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
  ]
  let timeMinimum = Infinity
  let timeMaximum = -Infinity
  for (let index = 0; index < count; index += 1) {
    const record = records[index]
    const coordinate = fromLonLat([record.longitude, record.latitude])
    x[index] = coordinate[0]
    y[index] = coordinate[1]
    semiMajor[index] = record.semiMajor ?? 0
    semiMinor[index] = record.semiMinor ?? 0
    rotation[index] = ((90 - (record.tilt ?? 0)) * Math.PI) / 180
    time[index] = record.time ?? Number.NaN
    colors[index] = record.color ?? packRgba(0, 128, 0)
    extent[0] = Math.min(extent[0], coordinate[0])
    extent[1] = Math.min(extent[1], coordinate[1])
    extent[2] = Math.max(extent[2], coordinate[0])
    extent[3] = Math.max(extent[3], coordinate[1])
    if (Number.isFinite(time[index])) {
      timeMinimum = Math.min(timeMinimum, time[index])
      timeMaximum = Math.max(timeMaximum, time[index])
    }
  }
  return {
    dataset: {
      x,
      y,
      semiMajor,
      semiMinor,
      rotation,
      time,
      colors,
      timeHistogram: new Uint32Array(),
      extent,
      index: buildCompactSpatialIndex(x, y),
    },
    summary: {
      name,
      rowCount: count,
      invalidRows: 0,
      invalidTimestamps: 0,
      coordinateFailures: 0,
      projectionClampedRows: 0,
      timeMin: timeMinimum === Infinity ? Number.NaN : timeMinimum,
      timeMax: timeMaximum === -Infinity ? Number.NaN : timeMaximum,
    },
  }
}

/**
 * Matches ol_bridge.js ellipse_polygon_lonlat: tilt is a bearing clockwise
 * from true north and axes are Web Mercator metres.
 */
export function createEllipsePolygon(
  latitude: number,
  longitude: number,
  semiMajor: number,
  semiMinor: number,
  tiltDegrees: number,
  segments = 72
): Polygon {
  const [centerX, centerY] = fromLonLat([longitude, latitude])
  const tilt = ((90 - tiltDegrees) * Math.PI) / 180
  const cosine = Math.cos(tilt)
  const sine = Math.sin(tilt)
  const ring: [number, number][] = []
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * 2 * Math.PI
    const ellipseX = semiMajor * Math.cos(angle)
    const ellipseY = semiMinor * Math.sin(angle)
    ring.push([
      centerX + ellipseX * cosine - ellipseY * sine,
      centerY + ellipseX * sine + ellipseY * cosine,
    ])
  }
  return new Polygon([ring])
}
