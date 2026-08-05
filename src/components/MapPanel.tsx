import { useEffect, useRef } from 'react'
import { FastPointEngine } from '../map/FastPointEngine'
import type {
  EngineSelectionState,
  MeasurementState,
  RenderMetrics,
} from '../lib/types'

type MapPanelProps = {
  onEngine: (engine: FastPointEngine | null) => void
  onSelectionChange: (state: EngineSelectionState) => void
  onMetrics: (metrics: RenderMetrics) => void
  onPointerCoordinate: (coordinate: [number, number] | null) => void
  onMeasurementChange: (state: MeasurementState) => void
}

export function MapPanel({
  onEngine,
  onSelectionChange,
  onMetrics,
  onPointerCoordinate,
  onMeasurementChange,
}: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({
    onSelectionChange,
    onMetrics,
    onPointerCoordinate,
    onMeasurementChange,
    onEngine,
  })
  callbacks.current = {
    onSelectionChange,
    onMetrics,
    onPointerCoordinate,
    onMeasurementChange,
    onEngine,
  }

  useEffect(() => {
    if (!containerRef.current) return
    const engine = new FastPointEngine({
      target: containerRef.current,
      onSelectionChange: (state) => callbacks.current.onSelectionChange(state),
      onMetrics: (metrics) => callbacks.current.onMetrics(metrics),
      onPointerCoordinate: (coordinate) =>
        callbacks.current.onPointerCoordinate(coordinate),
      onMeasurementChange: (state) =>
        callbacks.current.onMeasurementChange(state),
    })
    callbacks.current.onEngine(engine)
    const observer = new ResizeObserver(() => engine.map.updateSize())
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      callbacks.current.onEngine(null)
      engine.dispose()
    }
  }, [])

  return <div className="map-canvas" ref={containerRef} aria-label="Map" />
}
