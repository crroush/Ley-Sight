// src/workers/terrain.ts
import { WEB_MERCATOR_WORLD_WIDTH_M, WEB_MERCATOR_HALF_WORLD_M } from './grid'

export const AWS_TERRARIUM_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
export const TERRAIN_TILE_SIZE = 256
export const TERRAIN_MAX_ZOOM = 15

/**
 * Port of terrain_zoom_for_spacing to select the appropriate DEM zoom level.
 */
export function terrainZoomForSpacing(
  sampleSpacingM: number,
  samplesPerGridCell: number = 1.5
): number {
  const spacingM = Math.max(1.0, sampleSpacingM)
  const samplesPerCell = Math.max(0.5, samplesPerGridCell)
  const targetPixelM = Math.max(4.0, spacingM / samplesPerCell)

  let zoom = Math.ceil(
    Math.log2(WEB_MERCATOR_WORLD_WIDTH_M / (TERRAIN_TILE_SIZE * targetPixelM))
  )
  return Math.max(0, Math.min(TERRAIN_MAX_ZOOM, zoom))
}
const TILE_SIZE = 256

export class TerrariumTerrainProvider {
  // Existing properties...
  private tileCache = new Map<string, Uint8ClampedArray>()

  constructor(
    private readonly tileLoader?: (
      z: number,
      x: number,
      y: number
    ) => Promise<Uint8ClampedArray | null>
  ) {}

  /**
   * Internal helper to load and decode a tile via OffscreenCanvas
   */
  private async loadTileData(
    z: number,
    x: number,
    y: number
  ): Promise<Uint8ClampedArray | null> {
    const key = `${z}/${x}/${y}`
    if (this.tileCache.has(key)) return this.tileCache.get(key)!

    if (this.tileLoader) {
      const data = await this.tileLoader(z, x, y)
      if (data) this.tileCache.set(key, data)
      return data
    }

    try {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
      const response = await fetch(url)
      if (!response.ok) return null

      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)

      const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      ctx.drawImage(bitmap, 0, 0)
      const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)

      this.tileCache.set(key, imageData.data)
      return imageData.data
    } catch (err) {
      return null
    }
  }

  /**
   * Identifies unique tiles for an entire grid, downloads them in one bulk Promise.all,
   * and synchronously extracts the pixel data in memory.
   */
  public async sampleGrid(
    xs: Float64Array,
    ys: Float64Array,
    zoom: number
  ): Promise<Float64Array> {
    const n = Math.pow(2, zoom)
    const w = WEB_MERCATOR_WORLD_WIDTH_M

    const requiredTiles = new Set<string>()
    const tileCoords = new Array<{
      tx: number
      ty: number
      px: number
      py: number
    }>(xs.length)

    // 1. Calculate tile indices for every pixel
    for (let i = 0; i < xs.length; i++) {
      const normX = (xs[i] + w / 2.0) / w
      const normY = (w / 2.0 - ys[i]) / w

      const exactTx = normX * n
      const exactTy = normY * n

      const tx = Math.floor(exactTx)
      const ty = Math.floor(exactTy)

      const clampedTx = Math.max(0, Math.min(n - 1, tx))
      const clampedTy = Math.max(0, Math.min(n - 1, ty))

      const px = Math.floor((exactTx - tx) * TILE_SIZE)
      const py = Math.floor((exactTy - ty) * TILE_SIZE)

      const clampedPx = Math.max(0, Math.min(TILE_SIZE - 1, px))
      const clampedPy = Math.max(0, Math.min(TILE_SIZE - 1, py))

      const key = `${zoom}/${clampedTx}/${clampedTy}`
      requiredTiles.add(key)
      tileCoords[i] = {
        tx: clampedTx,
        ty: clampedTy,
        px: clampedPx,
        py: clampedPy,
      }
    }

    // 2. Fetch only the unique tiles needed for this grid (usually 2 to 6 tiles)
    const fetchPromises = Array.from(requiredTiles).map((key) => {
      const [z, x, y] = key.split('/').map(Number)
      return this.loadTileData(z, x, y).then((data) => ({ key, data }))
    })

    const tileDataMap = new Map<string, Uint8ClampedArray | null>()
    const loadedTiles = await Promise.all(fetchPromises)
    for (const { key, data } of loadedTiles) {
      tileDataMap.set(key, data)
    }

    // 3. Synchronously extract the Terrarium math values
    const results = new Float64Array(xs.length)
    for (let i = 0; i < xs.length; i++) {
      const coord = tileCoords[i]
      const key = `${zoom}/${coord.tx}/${coord.ty}`
      const data = tileDataMap.get(key)

      if (data) {
        const idx = (coord.py * TILE_SIZE + coord.px) * 4
        const r = data[idx]
        const g = data[idx + 1]
        const b = data[idx + 2]
        results[i] = r * 256.0 + g + b / 256.0 - 32768.0
      } else {
        // A Terrarium pixel containing zero is a valid sea-level sample.  A
        // tile which could not be read is different and must remain
        // distinguishable by callers so that they can apply (and report) an
        // explicit missing-data policy.
        results[i] = Number.NaN
      }
    }

    return results
  }

  // Retain your existing samplePoint logic for the Inspector Tool
  public async samplePoint(
    xM: number,
    yM: number,
    zoom: number
  ): Promise<number> {
    const arr = await this.sampleGrid(
      new Float64Array([xM]),
      new Float64Array([yM]),
      zoom
    )
    return arr[0]
  }
}
