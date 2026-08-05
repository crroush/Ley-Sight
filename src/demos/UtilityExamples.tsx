import { useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature.js'
import LineString from 'ol/geom/LineString.js'
import Point from 'ol/geom/Point.js'
import ImageLayer from 'ol/layer/Image.js'
import VectorLayer from 'ol/layer/Vector.js'
import TileLayer from 'ol/layer/Tile.js'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import { createEmpty, extend } from 'ol/extent.js'
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj.js'
import { getDistance } from 'ol/sphere.js'
import ImageStatic from 'ol/source/ImageStatic.js'
import OSM from 'ol/source/OSM.js'
import VectorSource from 'ol/source/Vector.js'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style.js'
import {
  installReferenceCoordinateDisplay,
  type ReferenceCoordinateDisplay,
} from '../map/referenceCoordinateDisplay'

function landmarkStyle(color: string, stroke: string, radius: number): Style {
  return new Style({
    image: new CircleStyle({
      radius,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: stroke, width: 2 }),
    }),
  })
}

type MeasurementRow = {
  distance: number | null
  latitude: number
  longitude: number
}

/** Browser port of examples/11_measurement_tool.py. */
export function MeasurementExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLElement>(null)
  const measurementSourceRef = useRef(new VectorSource())
  const coordinatesRef = useRef<[number, number][]>([])
  const enabledRef = useRef(false)
  const [enabled, setEnabled] = useState(false)
  const [clearEnabled, setClearEnabled] = useState(false)
  const [rows, setRows] = useState<MeasurementRow[]>([])
  const [mapPercent, setMapPercent] = useState(75.38)

  useEffect(() => {
    if (!mapTargetRef.current) return
    document.title = 'Interactive Distance Measurement Tool'
    const landmarkSource = new VectorSource({
      features: [
        [37.7749, -122.4194, 'San Francisco City Hall'],
        [37.8199, -122.4783, 'Golden Gate Bridge'],
        [37.8088, -122.4098, 'Ferry Building'],
      ].map(([latitude, longitude, name]) => {
        const feature = new Feature(
          new Point(fromLonLat([Number(longitude), Number(latitude)]))
        )
        feature.setId(String(name))
        return feature
      }),
    })
    const measurementLayer = new VectorLayer({
      source: measurementSourceRef.current,
      style: (feature) =>
        feature.getGeometry()?.getType() === 'Point'
          ? new Style({
              image: new CircleStyle({
                radius: 5,
                fill: new Fill({ color: '#fff' }),
                stroke: new Stroke({ color: '#22a6d5', width: 2 }),
              }),
            })
          : new Style({
              stroke: new Stroke({ color: '#22a6d5', width: 3 }),
            }),
    })
    const map = new Map({
      target: mapTargetRef.current,
      layers: [
        new TileLayer({ source: new OSM({ transition: 0 }) }),
        new VectorLayer({
          source: landmarkSource,
          style: landmarkStyle('blue', 'darkblue', 8),
        }),
        measurementLayer,
      ],
      view: new View({
        center: fromLonLat([-122.4194, 37.7749]),
        zoom: 11,
      }),
    })
    const coordinateDisplay = installReferenceCoordinateDisplay(
      map,
      mapTargetRef.current
    )
    map.on('singleclick', (event) => {
      if (!enabledRef.current) return
      const coordinate = event.coordinate as [number, number]
      const previous = coordinatesRef.current.at(-1)
      coordinatesRef.current.push(coordinate)
      const [longitude, latitude] = toLonLat(coordinate)
      const distance = previous
        ? getDistance(toLonLat(previous), [longitude, latitude])
        : null
      setRows((current) => [...current, { distance, latitude, longitude }])
      measurementSourceRef.current.addFeature(
        new Feature(new Point(coordinate))
      )
      const existingLine = measurementSourceRef.current.getFeatureById('path')
      if (existingLine) {
        existingLine.setGeometry(new LineString(coordinatesRef.current))
      } else {
        const line = new Feature(new LineString(coordinatesRef.current))
        line.setId('path')
        measurementSourceRef.current.addFeature(line)
      }
    })
    const observer = new ResizeObserver(() => map.updateSize())
    observer.observe(mapTargetRef.current)
    return () => {
      observer.disconnect()
      coordinateDisplay.dispose()
      map.setTarget(undefined)
    }
  }, [])

  const totalMeters = rows.reduce(
    (total, row) => total + (row.distance ?? 0),
    0
  )
  const clear = (): void => {
    coordinatesRef.current = []
    measurementSourceRef.current.clear()
    setRows([])
  }

  return (
    <main className="reference-example-window">
      <section
        className="reference-measurement-layout"
        ref={layoutRef}
        style={{
          gridTemplateColumns: `minmax(500px, ${mapPercent}%) 6px minmax(280px, 1fr)`,
        }}
      >
        <div className="reference-measurement-map-column">
          <section className="reference-description-controls">
            <p>
              Enable measurement mode and click on the map to add points. The
              side panel will show each segment distance and the running total.
            </p>
            <button
              className={enabled ? 'is-danger' : ''}
              type="button"
              onClick={() => {
                enabledRef.current = !enabled
                setEnabled(!enabled)
                if (!enabled) setClearEnabled(true)
              }}
            >
              {enabled ? 'Disable Measurement Mode' : 'Enable Measurement Mode'}
            </button>
            <button type="button" disabled={!clearEnabled} onClick={clear}>
              Clear Measurements
            </button>
          </section>
          <div className="reference-map-fill" ref={mapTargetRef} />
        </div>
        <div
          className="reference-column-separator"
          role="separator"
          aria-label="Resize map and measurement summary"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            event.currentTarget.classList.add('is-dragging')
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            const bounds = layoutRef.current?.getBoundingClientRect()
            if (!bounds || bounds.width <= 0) return
            const percent = ((event.clientX - bounds.left) / bounds.width) * 100
            setMapPercent(Math.max(45, Math.min(80, percent)))
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            event.currentTarget.classList.remove('is-dragging')
          }}
          onPointerCancel={(event) =>
            event.currentTarget.classList.remove('is-dragging')
          }
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              setMapPercent((current) => Math.max(45, current - 2))
            } else if (event.key === 'ArrowRight') {
              setMapPercent((current) => Math.min(80, current + 2))
            } else {
              return
            }
            event.preventDefault()
          }}
        />
        <aside className="reference-measurement-summary">
          <h2>Measurement Summary</h2>
          <p>Points: {rows.length}</p>
          <ol>
            {rows.map((row, index) => (
              <li key={`${row.latitude}-${row.longitude}-${index}`}>
                {row.distance == null
                  ? `Start: (${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)})`
                  : `Segment ${index}: ${row.distance.toFixed(1)} m  (${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)})`}
              </li>
            ))}
          </ol>
          <strong>Total: {(totalMeters / 1_000).toFixed(2)} km</strong>
        </aside>
      </section>
    </main>
  )
}

/** Browser port of examples/12_coordinate_display.py. */
export function CoordinateDisplayExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null)
  const coordinateDisplayRef = useRef<ReferenceCoordinateDisplay | null>(null)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (!mapTargetRef.current) return
    document.title = 'Coordinate Display Toggle'
    const cities = [
      [37.7749, -122.4194, 'San Francisco', 'red'],
      [37.8044, -122.2712, 'Oakland', 'blue'],
      [37.3382, -121.8863, 'San Jose', 'green'],
    ].map(([latitude, longitude, name, color]) => {
      const feature = new Feature(
        new Point(fromLonLat([Number(longitude), Number(latitude)]))
      )
      feature.setId(String(name))
      feature.set('color', color)
      return feature
    })
    const map = new Map({
      target: mapTargetRef.current,
      layers: [
        new TileLayer({ source: new OSM({ transition: 0 }) }),
        new VectorLayer({
          source: new VectorSource({ features: cities }),
          style: (feature) =>
            landmarkStyle(String(feature.get('color')), 'black', 10),
        }),
      ],
      view: new View({
        center: fromLonLat([-122.4194, 37.7749]),
        zoom: 10,
      }),
    })
    const coordinateDisplay = installReferenceCoordinateDisplay(
      map,
      mapTargetRef.current
    )
    coordinateDisplayRef.current = coordinateDisplay
    return () => {
      coordinateDisplay.dispose()
      coordinateDisplayRef.current = null
      map.setTarget(undefined)
    }
  }, [])

  return (
    <main className="reference-example-window">
      <section className="reference-coordinate-controls">
        <p>
          Move your mouse over the map to see coordinates in the lower-right
          corner. Use the button to toggle coordinate display on/off.
        </p>
        <button
          type="button"
          onClick={() => {
            const next = !visible
            setVisible(next)
            coordinateDisplayRef.current?.setVisible(next)
          }}
        >
          {visible ? 'Hide Coordinates' : 'Show Coordinates'}
        </button>
        <strong className={visible ? 'is-enabled' : 'is-disabled'}>
          Coordinates shown: {visible ? 'Enabled' : 'Disabled'}
        </strong>
      </section>
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  )
}

function demoRasterUrl(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable.')
  const polygon = [
    [0.1, 0.25],
    [0.55, 0.15],
    [0.88, 0.35],
    [0.78, 0.78],
    [0.28, 0.88],
    [0.08, 0.55],
  ]
  context.beginPath()
  polygon.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x * 512, y * 512)
    else context.lineTo(x * 512, y * 512)
  })
  context.closePath()
  context.fillStyle = 'rgba(45, 130, 255, 0.667)'
  context.strokeStyle = 'rgba(0, 0, 0, 0.863)'
  context.lineWidth = 3
  context.fill()
  context.stroke()
  const inner = [
    [0.28, 0.35],
    [0.62, 0.32],
    [0.68, 0.62],
    [0.35, 0.72],
  ]
  context.beginPath()
  inner.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x * 512, y * 512)
    else context.lineTo(x * 512, y * 512)
  })
  context.closePath()
  context.fillStyle = 'rgba(255, 200, 40, 0.706)'
  context.strokeStyle = 'rgba(20, 20, 20, 0.863)'
  context.lineWidth = 2
  context.fill()
  context.stroke()
  return canvas.toDataURL('image/png')
}

const FIT_RASTER_EXTENT = transformExtent(
  [-122.8, 33, -116.8, 38.8],
  'EPSG:4326',
  'EPSG:3857'
)

/** Browser port of examples/15_load_data_and_zoom.py. */
export function FitToDataExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const vectorSourceRef = useRef(new VectorSource())
  const rasterLayerRef = useRef(new ImageLayer({ opacity: 0.45 }))
  const [pointsLoaded, setPointsLoaded] = useState(false)
  const [rasterLoaded, setRasterLoaded] = useState(false)
  const [status, setStatus] = useState(
    "Click 'Load Sample Data', then 'Zoom to Loaded Data'."
  )

  useEffect(() => {
    if (!mapTargetRef.current) return
    document.title = 'Load Data and Zoom Example'
    const vectorLayer = new VectorLayer({
      source: vectorSourceRef.current,
      style: (feature) =>
        new Style({
          image: new CircleStyle({
            radius: 8,
            fill: new Fill({ color: String(feature.get('color')) }),
            stroke: new Stroke({ color: 'black', width: 1.5 }),
          }),
        }),
    })
    const map = new Map({
      target: mapTargetRef.current,
      layers: [
        new TileLayer({ source: new OSM({ transition: 0 }) }),
        rasterLayerRef.current,
        vectorLayer,
      ],
      view: new View({ center: fromLonLat([0, 20]), zoom: 2 }),
    })
    const coordinateDisplay = installReferenceCoordinateDisplay(
      map,
      mapTargetRef.current
    )
    mapRef.current = map
    return () => {
      coordinateDisplay.dispose()
      map.setTarget(undefined)
      mapRef.current = null
    }
  }, [])

  const loadPoints = (): void => {
    vectorSourceRef.current.clear()
    const points = [
      [37.7749, -122.4194, 'sf', 'tomato'],
      [38.5816, -121.4944, 'sac', 'tomato'],
      [36.7378, -119.7871, 'fre', 'tomato'],
      [34.0522, -118.2437, 'la', 'royalblue'],
      [32.7157, -117.1611, 'sd', 'royalblue'],
      [33.7455, -117.8677, 'ana', 'royalblue'],
    ]
    vectorSourceRef.current.addFeatures(
      points.map(([latitude, longitude, id, color]) => {
        const feature = new Feature(
          new Point(fromLonLat([Number(longitude), Number(latitude)]))
        )
        feature.setId(String(id))
        feature.set('color', color)
        return feature
      })
    )
    setPointsLoaded(true)
    setStatus('Data loaded: 6 points across California.')
  }

  const loadRaster = (): void => {
    rasterLayerRef.current.setSource(
      new ImageStatic({
        url: demoRasterUrl(),
        imageExtent: FIT_RASTER_EXTENT,
        projection: 'EPSG:3857',
      })
    )
    setRasterLoaded(true)
    setStatus('Raster loaded in California extent.')
  }

  const fit = (): void => {
    const map = mapRef.current
    if (!map || (!pointsLoaded && !rasterLoaded)) {
      setStatus('Load points and/or raster first.')
      return
    }
    const extent = createEmpty()
    const vectorExtent = vectorSourceRef.current.getExtent()
    if (pointsLoaded && vectorExtent) extend(extent, vectorExtent)
    if (rasterLoaded) extend(extent, FIT_RASTER_EXTENT)
    map.getView().fit(extent, {
      padding: [48, 48, 48, 48],
      maxZoom: 6,
      duration: 250,
    })
    setStatus('Applied fit_to_data() across loaded map layers.')
  }

  return (
    <main className="reference-example-window">
      <section className="reference-fit-controls">
        <button type="button" onClick={loadPoints}>
          Load Sample Data
        </button>
        <button type="button" onClick={fit}>
          Zoom to Loaded Data
        </button>
        <button type="button" onClick={loadRaster}>
          Load Raster
        </button>
        <button
          type="button"
          onClick={() =>
            mapRef.current?.getView().animate({
              center: fromLonLat([0, 20]),
              zoom: 2,
              duration: 0,
            })
          }
        >
          Reset to World View
        </button>
        <span>{status}</span>
      </section>
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  )
}
