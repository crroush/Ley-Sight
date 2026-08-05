import { useEffect, useRef, useState } from 'react'
import ImageLayer from 'ol/layer/Image.js'
import TileLayer from 'ol/layer/Tile.js'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import ImageStatic from 'ol/source/ImageStatic.js'
import OSM from 'ol/source/OSM.js'
import { fromLonLat, transformExtent } from 'ol/proj.js'
import { Image as ImageIcon, RefreshCw, TimerReset } from 'lucide-react'
import type { MaskShape } from '../lib/rasterMasks'
import { DemoHeader } from './DemoHeader'

type RasterResult = {
  type: 'complete'
  requestId: number
  width: number
  height: number
  pixels: Uint8ClampedArray<ArrayBuffer>
  elapsedMs: number
}

const RASTER_EXTENT = transformExtent(
  [-109.5, 34.5, -94.0, 45.2],
  'EPSG:4326',
  'EPSG:3857'
)

function imageUrl(result: RasterResult): string {
  const canvas = document.createElement('canvas')
  canvas.width = result.width
  canvas.height = result.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable.')
  context.putImageData(
    new ImageData(result.pixels, result.width, result.height),
    0,
    0
  )
  return canvas.toDataURL('image/png')
}

export function RasterDemoApp() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<Map | null>(null)
  const rasterLayerRef = useRef(new ImageLayer({ opacity: 0.72 }))
  const workerRef = useRef<Worker | null>(null)
  const debounceRef = useRef<number | null>(null)
  const requestIdRef = useRef(0)
  const maskRef = useRef<MaskShape>('star')
  const qualityRef = useRef(0.7)
  const [mask, setMask] = useState<MaskShape>('star')
  const [quality, setQuality] = useState(0.7)
  const [opacity, setOpacity] = useState(0.72)
  const [status, setStatus] = useState('Waiting for initial render')
  const [lastRender, setLastRender] = useState('—')

  const requestRender = (reason: string): void => {
    const map = mapInstanceRef.current
    const worker = workerRef.current
    if (!map || !worker) return
    const size = map.getSize() ?? [900, 600]
    const requestId = ++requestIdRef.current
    const width = Math.max(
      220,
      Math.min(1_200, Math.round(size[0] * qualityRef.current))
    )
    const height = Math.max(
      160,
      Math.min(900, Math.round(size[1] * qualityRef.current))
    )
    setStatus(`${reason}: rendering ${width}×${height}; older work interrupted`)
    worker.postMessage({
      type: 'render',
      requestId,
      width,
      height,
      mask: maskRef.current,
    })
  }

  const scheduleRender = (reason: string): void => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => requestRender(reason), 280)
  }

  useEffect(() => {
    if (!mapRef.current) return
    const worker = new Worker(
      new URL('../workers/raster.worker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<RasterResult>) => {
      if (
        event.data.type !== 'complete' ||
        event.data.requestId !== requestIdRef.current
      ) {
        return
      }
      const url = imageUrl(event.data)
      rasterLayerRef.current.setSource(
        new ImageStatic({
          url,
          imageExtent: RASTER_EXTENT,
          projection: 'EPSG:3857',
        })
      )
      setLastRender(
        `${event.data.width}×${event.data.height} in ${event.data.elapsedMs.toFixed(0)} ms`
      )
      setStatus('Latest raster applied')
    }

    const map = new Map({
      target: mapRef.current,
      layers: [new TileLayer({ source: new OSM() }), rasterLayerRef.current],
      view: new View({
        center: fromLonLat([-101.5, 40]),
        zoom: 4.5,
      }),
    })
    mapInstanceRef.current = map
    map.on('moveend', () => scheduleRender('Viewport resolution changed'))
    window.setTimeout(() => requestRender('Initial render'), 0)

    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
      worker.terminate()
      workerRef.current = null
      map.setTarget(undefined)
      mapInstanceRef.current = null
    }
  }, [])

  return (
    <div className="demo-app">
      <DemoHeader
        title="Raster masks and interruptible rendering"
        description="Fixed geographic image footprint, arbitrary masks, viewport-derived resolution, debounce, and hard interruption."
        useCases={[5, 14]}
      />
      <div className="demo-toolbar">
        <label className="toolbar-field">
          <span>Mask</span>
          <select
            value={mask}
            onChange={(event) => {
              const next = event.target.value as MaskShape
              maskRef.current = next
              setMask(next)
              scheduleRender('Mask changed')
            }}
          >
            <option value="rectangle">Rectangle</option>
            <option value="circle">Circle</option>
            <option value="triangle">Triangle</option>
            <option value="hexagon">Hexagon</option>
            <option value="star">Star</option>
            <option value="irregular">Irregular polygon</option>
          </select>
        </label>
        <label className="toolbar-field">
          <span>Quality {Math.round(quality * 100)}%</span>
          <input
            type="range"
            min="0.25"
            max="1.25"
            step="0.05"
            value={quality}
            onChange={(event) => {
              const next = Number(event.target.value)
              qualityRef.current = next
              setQuality(next)
              scheduleRender('Quality changed')
            }}
          />
        </label>
        <label className="toolbar-field">
          <span>Opacity {Math.round(opacity * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(event) => {
              const next = Number(event.target.value)
              setOpacity(next)
              rasterLayerRef.current.setOpacity(next)
            }}
          />
        </label>
        <button
          className="tool-button"
          onClick={() => requestRender('Manual render')}
        >
          <RefreshCw size={15} /> Render now
        </button>
      </div>
      <main className="demo-content">
        <div className="demo-map">
          <div className="demo-map-target" ref={mapRef} />
          <div className="demo-overlay-note">
            Zoom repeatedly or drag Quality quickly: only the newest worker
            generation is applied.
          </div>
        </div>
        <aside className="demo-sidebar">
          <section className="demo-status-card">
            <TimerReset size={18} />
            <strong>{status}</strong>
            <p>Last completed: {lastRender}</p>
          </section>
          <section>
            <h2>
              <ImageIcon size={14} /> Rendering contract
            </h2>
            <ul>
              <li>The geographic footprint does not change with zoom.</li>
              <li>Transparent pixels create non-rectangular masks.</li>
              <li>Resolution follows current map pixel dimensions.</li>
              <li>
                Worker work yields and exits when a newer generation arrives.
              </li>
            </ul>
          </section>
        </aside>
      </main>
    </div>
  )
}
