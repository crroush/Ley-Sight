/// <reference lib="webworker" />

import { insideMask, polygonForMask, type MaskShape } from '../lib/rasterMasks'

type RasterRequest = {
  type: 'render'
  requestId: number
  width: number
  height: number
  mask: MaskShape
  profile?: 'reference05' | 'reference14' | 'interrupt'
  quality?: number
  qLon?: number
  qLat?: number
}

type RasterResult = {
  type: 'complete'
  requestId: number
  width: number
  height: number
  pixels: Uint8ClampedArray<ArrayBuffer>
  elapsedMs: number
}

const worker = self as DedicatedWorkerGlobalScope
let generation = 0

const REFERENCE05_X = [
  0.7739560485559633, 0.4388784397520523, 0.8585979199113825,
  0.6973680290593639, 0.09417734788764953, 0.9756223516367559,
  0.761139701990353, 0.7860643052769538, 0.12811363267554587,
  0.45038593789556713, 0.37079802423258124, 0.9267649888486018,
  0.6438651200806645, 0.82276161327083, 0.44341419882733113, 0.2272387217847769,
  0.5545847870158348, 0.06381725610417532, 0.8276311719925821,
  0.6316643991220649,
] as const
const REFERENCE05_Y = [
  0.7580877400853738, 0.35452596812986836, 0.9706980243949033,
  0.8931211213221977, 0.7783834970737619, 0.19463870785196757,
  0.4667210037270342, 0.04380376578722878, 0.15428949206754783,
  0.6830489532424546, 0.7447621559078171, 0.96750973243421, 0.32582535813815194,
  0.3704597060348689, 0.4695558112758079, 0.1894713590842857,
  0.12992150533547164, 0.47570492622593374, 0.2269093490508841,
  0.6698139946825103,
] as const
const REFERENCE05_VALUES = [
  0.43715191887233074, 0.8326781960578374, 0.7002651020022491,
  0.31236664138204107, 0.8322598013952011, 0.8047643574968019,
  0.38747837903017446, 0.2883281039302441, 0.6824955039749755,
  0.1397524836093098, 0.19990820247510832, 0.007362269751005512,
  0.7869243775021384, 0.6648508565920321, 0.7051653786263351,
  0.7807290310219679, 0.45891577553833995, 0.5687411959528937,
  0.13979699812765745, 0.11453007353597344,
] as const
const REFERENCE05_COLORS = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
] as const

function reference14Polygon(
  width: number,
  height: number
): readonly (readonly [number, number])[] {
  const coordinates = [
    [37.7, -122.545],
    [37.735, -122.515],
    [37.8, -122.5],
    [37.845, -122.465],
    [37.842, -122.41],
    [37.815, -122.365],
    [37.77, -122.34],
    [37.725, -122.36],
    [37.695, -122.42],
    [37.682, -122.49],
  ] as const
  const latitudeMinimum = 37.682
  const latitudeMaximum = 37.845
  const longitudeMinimum = -122.545
  const longitudeMaximum = -122.34
  return coordinates.map(
    ([latitude, longitude]) =>
      [
        ((longitude - longitudeMinimum) /
          (longitudeMaximum - longitudeMinimum)) *
          (width - 1),
        ((latitudeMaximum - latitude) / (latitudeMaximum - latitudeMinimum)) *
          (height - 1),
      ] as const
  )
}

async function renderReference14(
  request: RasterRequest,
  token: number,
  started: number
): Promise<void> {
  const width = request.width
  const height = request.height
  const quality = Math.max(1, Math.min(5, request.quality ?? 3))
  const qLon = Math.max(Number.EPSILON, request.qLon ?? 0.001)
  const qLat = Math.max(Number.EPSILON, request.qLat ?? 0.001)

  // Reference starts with intentionally expensive native matrix work. This bounded
  // warm-up preserves visible compute latency while the owning page can still
  // hard-interrupt it by terminating the worker.
  let accumulator = 0
  const warmup = quality * 450_000
  for (let index = 0; index < warmup; index += 1) {
    accumulator += Math.sin(index * 0.00017) * Math.cos(index * 0.00011)
  }

  const values = new Float32Array(width * height)
  let minimum = Infinity
  let maximum = -Infinity
  const longitudeMinimum = -122.545
  const longitudeMaximum = -122.34
  const latitudeMinimum = 37.682
  const latitudeMaximum = 37.845
  for (let y = 0; y < height; y += 1) {
    if (token !== generation) return
    const latitude =
      latitudeMaximum -
      (y / Math.max(1, height - 1)) * (latitudeMaximum - latitudeMinimum)
    const latitudeQuantized = Math.round(latitude / qLat) * qLat
    for (let x = 0; x < width; x += 1) {
      const longitude =
        longitudeMinimum +
        (x / Math.max(1, width - 1)) * (longitudeMaximum - longitudeMinimum)
      const longitudeQuantized = Math.round(longitude / qLon) * qLon
      const fieldX = (longitudeQuantized + 122.45) * 70
      const fieldY = (latitudeQuantized - 37.77) * 70
      let value =
        0.45 * Math.exp(-((fieldX + 2) ** 2 + (fieldY - 1.5) ** 2) / 8) +
        0.35 * Math.exp(-((fieldX - 1) ** 2 + (fieldY + 2.2) ** 2) / 5.5) +
        0.2 * Math.sin(2.3 * fieldX) * Math.cos(1.9 * fieldY) +
        0.1 * Math.sin(7 * fieldX + 1.2 * fieldY) +
        0.08 * Math.cos(6.3 * fieldY - 1.5 * fieldX)
      value += 0.02 * Math.sin(longitude * 180) * Math.cos(latitude * 220)
      // Keep the warm-up observable to the optimizer without changing the
      // field at a meaningful precision.
      value += accumulator * Number.EPSILON
      const offset = y * width + x
      values[offset] = value
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
  }

  const pixels = new Uint8ClampedArray(width * height * 4)
  const scale = maximum > minimum ? 1 / (maximum - minimum) : 0
  const polygon = reference14Polygon(width, height)
  for (let y = 0; y < height; y += 1) {
    if (token !== generation) return
    for (let x = 0; x < width; x += 1) {
      if (!insideMask(x, y, width, height, 'irregular', polygon)) continue
      const value = (values[y * width + x] - minimum) * scale
      const color =
        REFERENCE05_COLORS[Math.max(0, Math.min(4, Math.trunc(value * 4)))]
      const offset = (y * width + x) * 4
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = 255
    }
  }
  if (token !== generation) return
  worker.postMessage(
    {
      type: 'complete',
      requestId: request.requestId,
      width,
      height,
      pixels,
      elapsedMs: performance.now() - started,
    } satisfies RasterResult,
    [pixels.buffer]
  )
}

async function renderReference05(
  request: RasterRequest,
  token: number,
  started: number
): Promise<void> {
  const values = new Float32Array(request.width * request.height)
  let minimum = Infinity
  let maximum = -Infinity
  for (let y = 0; y < request.height; y += 1) {
    if (token !== generation) return
    for (let x = 0; x < request.width; x += 1) {
      let value = 0
      for (let point = 0; point < REFERENCE05_VALUES.length; point += 1) {
        const deltaX = x - REFERENCE05_X[point] * request.width
        const deltaY = y - REFERENCE05_Y[point] * request.height
        const distance = Math.max(Math.hypot(deltaX, deltaY), 1)
        value += REFERENCE05_VALUES[point] / (distance + 10)
      }
      const offset = y * request.width + x
      values[offset] = value
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
    if (y % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const pixels = new Uint8ClampedArray(request.width * request.height * 4)
  const polygon = polygonForMask(request.mask, request.width, request.height)
  const scale = maximum > minimum ? 1 / (maximum - minimum) : 0
  for (let y = 0; y < request.height; y += 1) {
    if (token !== generation) return
    for (let x = 0; x < request.width; x += 1) {
      if (
        !insideMask(x, y, request.width, request.height, request.mask, polygon)
      )
        continue
      const value = (values[y * request.width + x] - minimum) * scale
      const color =
        REFERENCE05_COLORS[Math.max(0, Math.min(4, Math.trunc(value * 4)))]
      const offset = (y * request.width + x) * 4
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = 255
    }
    if (y % 24 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (token !== generation) return
  worker.postMessage(
    {
      type: 'complete',
      requestId: request.requestId,
      width: request.width,
      height: request.height,
      pixels,
      elapsedMs: performance.now() - started,
    } satisfies RasterResult,
    [pixels.buffer]
  )
}

async function renderRaster(
  request: RasterRequest,
  token: number
): Promise<void> {
  const started = performance.now()
  if (request.profile === 'reference05') {
    await renderReference05(request, token, started)
    return
  }
  if (request.profile === 'reference14') {
    await renderReference14(request, token, started)
    return
  }
  const pixels = new Uint8ClampedArray(request.width * request.height * 4)
  const polygon = polygonForMask(request.mask, request.width, request.height)
  for (let y = 0; y < request.height; y += 1) {
    if (token !== generation) return
    const normalizedY = y / Math.max(1, request.height - 1)
    for (let x = 0; x < request.width; x += 1) {
      const normalizedX = x / Math.max(1, request.width - 1)
      if (
        !insideMask(x, y, request.width, request.height, request.mask, polygon)
      ) {
        continue
      }
      const dx = normalizedX - 0.5
      const dy = normalizedY - 0.5
      const radial = Math.exp(-(dx * dx + dy * dy) * 13)
      const wave =
        0.22 * (Math.sin(normalizedX * 28) * Math.cos(normalizedY * 21) + 1)
      const value = Math.max(0, Math.min(1, radial * 0.78 + wave))
      const offset = (y * request.width + x) * 4
      pixels[offset] = Math.round(255 * value)
      pixels[offset + 1] = Math.round(210 * Math.sqrt(value))
      pixels[offset + 2] = Math.round(255 * (1 - value))
      pixels[offset + 3] = Math.round(205 * Math.min(1, value + 0.15))
    }
    // Yield so a newer render request can hard-interrupt this generation.
    if (y % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (token !== generation) return
  const result: RasterResult = {
    type: 'complete',
    requestId: request.requestId,
    width: request.width,
    height: request.height,
    pixels,
    elapsedMs: performance.now() - started,
  }
  worker.postMessage(result, [pixels.buffer])
}

worker.onmessage = (event: MessageEvent<RasterRequest>): void => {
  generation += 1
  void renderRaster(event.data, generation)
}

export {}
