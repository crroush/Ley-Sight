import { useEffect, useMemo, useRef, useState } from 'react'
import { fromLonLat } from 'ol/proj.js'
import { FastPointEngine } from '../map/FastPointEngine'
import {
  createReferenceDataset,
  createReferenceRandom,
  packRgba,
  type ReferencePointRecord,
} from './referenceData'

function useFastEngine(
  records: readonly ReferencePointRecord[],
  title: string,
  center: [number, number],
  zoom: number,
  configure: (engine: FastPointEngine) => void
) {
  const mapTargetRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<FastPointEngine | null>(null)

  useEffect(() => {
    if (!mapTargetRef.current) return
    document.title = title
    const engine = new FastPointEngine({ target: mapTargetRef.current })
    engineRef.current = engine
    const { dataset, summary } = createReferenceDataset(title, records)
    engine.loadDataset(dataset, summary)
    engine.map.getView().setCenter(fromLonLat(center))
    engine.map.getView().setZoom(zoom)
    configure(engine)
    const observer = new ResizeObserver(() => engine.map.updateSize())
    observer.observe(mapTargetRef.current)
    return () => {
      observer.disconnect()
      engine.dispose()
      engineRef.current = null
    }
  }, [center[0], center[1], configure, records, title, zoom])

  return { mapTargetRef, engineRef }
}

function fastPerformanceRecords(): ReferencePointRecord[] {
  const random = createReferenceRandom(42)
  // Preserve the Reference source's vectorized draw order: all latitudes are drawn
  // first, followed by all longitudes.
  const latitudes = Array.from({ length: 10_000 }, () => 32 + random() * 15)
  const longitudes = Array.from({ length: 10_000 }, () => -125 + random() * 15)
  const records: ReferencePointRecord[] = []
  for (let index = 0; index < 10_000; index += 1) {
    const latitude = latitudes[index]
    const ratio = (latitude - 32) / 15
    records.push({
      latitude,
      longitude: longitudes[index],
      color: packRgba(
        Math.trunc(255 * (1 - ratio)),
        100,
        Math.trunc(255 * ratio),
        200
      ),
    })
  }
  return records
}

const configurePerformance = (engine: FastPointEngine): void => {
  engine.setPointStyle({
    radius: 3,
    selectedRadius: 6,
    defaultColor: packRgba(0, 128, 0),
    selectedColor: packRgba(255, 255, 0),
  })
  engine.setCollapsePixels(1)
  engine.setEllipsesVisible(false)
  engine.setSelectedEllipsesVisible(false)
}

/** Browser port of examples/03_fast_points_performance.py. */
export function FastPointsPerformanceExampleApp() {
  const records = useMemo(fastPerformanceRecords, [])
  const { mapTargetRef } = useFastEngine(
    records,
    'Fast Points - High-Performance Rendering',
    [-120, 37],
    6,
    configurePerformance
  )
  return (
    <main className="reference-example-window">
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  )
}

function uncertaintyRecords(): ReferencePointRecord[] {
  const random = createReferenceRandom(42)
  const latitudes = Array.from(
    { length: 50 },
    () => 37.7749 + (random() - 0.5) * 0.1
  )
  const longitudes = Array.from(
    { length: 50 },
    () => -122.4194 + (random() - 0.5) * 0.1
  )
  const records = latitudes.map((latitude, index) => ({
    latitude,
    longitude: longitudes[index],
  }))
  const semiMajor = records.map(() => 50 + random() * 500)
  const semiMinor = records.map(() => 30 + random() * 200)
  const tilt = records.map(() => random() * 360)
  return records.map((record, index) => ({
    ...record,
    semiMajor: semiMajor[index],
    semiMinor: semiMinor[index],
    tilt: tilt[index],
    color: packRgba(70, 130, 180),
  }))
}

const configureUncertainty = (engine: FastPointEngine): void => {
  engine.setPointStyle({
    radius: 4,
    selectedRadius: 7,
    defaultColor: packRgba(70, 130, 180),
    selectedColor: packRgba(216, 27, 96),
  })
  engine.setCollapsePixels(4)
  engine.setEllipseStyle({
    ellipseWidth: 1.5,
    ellipseFillAlpha: 60,
    minEllipsePixels: 2,
  })
  engine.setEllipsesVisible(true)
  engine.setSelectedEllipsesVisible(true)
}

/** Browser port of examples/06_geo_uncertainty_ellipses.py. */
export function GeoUncertaintyExampleApp() {
  const records = useMemo(uncertaintyRecords, [])
  const [ellipsesVisible, setEllipsesVisible] = useState(true)
  const { mapTargetRef, engineRef } = useFastEngine(
    records,
    'Geolocation with Uncertainty Ellipses',
    [-122.4194, 37.7749],
    11,
    configureUncertainty
  )

  return (
    <main className="reference-example-window">
      <section className="reference-description-controls">
        <p>
          Click points to select them. Use the toggle to show/hide uncertainty
          ellipses.
        </p>
        <button
          className={!ellipsesVisible ? 'is-danger' : ''}
          type="button"
          onClick={() => {
            const visible = !ellipsesVisible
            setEllipsesVisible(visible)
            engineRef.current?.setEllipsesVisible(visible)
          }}
        >
          {ellipsesVisible ? 'Hide Ellipses' : 'Show Ellipses'}
        </button>
      </section>
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  )
}
