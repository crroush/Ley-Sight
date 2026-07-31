// src/workers/terrain.ts
import { WEB_MERCATOR_WORLD_WIDTH_M, WEB_MERCATOR_HALF_WORLD_M } from "./grid";

export const AWS_TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRAIN_TILE_SIZE = 256;
export const TERRAIN_MAX_ZOOM = 15;

/**
 * Port of terrain_zoom_for_spacing to select the appropriate DEM zoom level.
 */
export function terrainZoomForSpacing(
  sampleSpacingM: number,
  samplesPerGridCell: number = 1.5
): number {
  const spacingM = Math.max(1.0, sampleSpacingM);
  const samplesPerCell = Math.max(0.5, samplesPerGridCell);
  const targetPixelM = Math.max(4.0, spacingM / samplesPerCell);

  let zoom = Math.ceil(
    Math.log2(WEB_MERCATOR_WORLD_WIDTH_M / (TERRAIN_TILE_SIZE * targetPixelM))
  );
  return Math.max(0, Math.min(TERRAIN_MAX_ZOOM, zoom));
}

export class TerrariumTerrainProvider {
  private cache = new Map<string, Float32Array>();

  private getCacheKey(z: number, x: number, y: number): string {
    return `${z}/${x}/${y}`;
  }

  /**
   * Fetches an AWS Terrarium tile and decodes its RGB values into a Float32Array of meters.
   */
  async loadTile(z: number, x: number, y: number): Promise<Float32Array | null> {
    const key = this.getCacheKey(z, x, y);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const url = AWS_TERRARIUM_URL
      .replace('{z}', z.toString())
      .replace('{x}', x.toString())
      .replace('{y}', y.toString());

    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) return null;

      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);

      const canvas = new OffscreenCanvas(TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
      const pixels = imageData.data;

      const elevation = new Float32Array(TERRAIN_TILE_SIZE * TERRAIN_TILE_SIZE);

      // Terrarium encoding: elevation_m = red * 256 + green + blue / 256 - 32768
      for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        elevation[j] = (r * 256.0) + g + (b / 256.0) - 32768.0;
      }

      this.cache.set(key, elevation);
      return elevation;

    } catch (error) {
      console.error(`Failed to load tile ${key}`, error);
      return null;
    }
  }

  /**
   * Samples the elevation at a specific Web-Mercator coordinate.
   * Note: For the full viewshed, we will eventually batch this to interpolate over the entire grid.
   */
  async samplePoint(xM: number, yM: number, zoom: number): Promise<number> {
    const tileCount = 1 << zoom;
    const worldPixels = tileCount * TERRAIN_TILE_SIZE;

    // Map Web-Mercator meters to global pixel coordinates
    const globalX = ((xM + WEB_MERCATOR_HALF_WORLD_M) / WEB_MERCATOR_WORLD_WIDTH_M) * worldPixels;
    // Web Mercator Y origin is top-left for tiles, but meters go bottom-to-top
    const globalY = ((WEB_MERCATOR_HALF_WORLD_M - yM) / WEB_MERCATOR_WORLD_WIDTH_M) * worldPixels;

    const tileX = Math.floor(globalX / TERRAIN_TILE_SIZE) % tileCount;
    const tileY = Math.floor(globalY / TERRAIN_TILE_SIZE);

    // Handle wrapping for tileX, clamp tileY
    const safeTileX = (tileX + tileCount) % tileCount;
    const safeTileY = Math.max(0, Math.min(tileCount - 1, tileY));

    const tileData = await this.loadTile(zoom, safeTileX, safeTileY);
    if (!tileData) return 0.0; // Fallback to 0m if tile fails

    const localX = Math.floor(globalX) % TERRAIN_TILE_SIZE;
    const localY = Math.floor(globalY) % TERRAIN_TILE_SIZE;

    return tileData[localY * TERRAIN_TILE_SIZE + localX];
  }

  clearCache() {
    this.cache.clear();
  }
}
