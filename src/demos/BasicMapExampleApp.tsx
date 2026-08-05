import { useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import Select from 'ol/interaction/Select.js'
import { platformModifierKeyOnly, singleClick } from 'ol/events/condition.js'
import VectorLayer from 'ol/layer/Vector.js'
import TileLayer from 'ol/layer/Tile.js'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import { fromLonLat } from 'ol/proj.js'
import OSM from 'ol/source/OSM.js'
import VectorSource from 'ol/source/Vector.js'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style.js'
import { createPackagedCountryLayers } from '../map/countryLayers'
import { installReferenceCoordinateDisplay } from '../map/referenceCoordinateDisplay'

type City = {
  latitude: number
  longitude: number
  id: string
  color: string
}

const CITIES: readonly City[] = [
  {
    latitude: 37.7749,
    longitude: -122.4194,
    id: 'San Francisco',
    color: 'red',
  },
  { latitude: 34.0522, longitude: -118.2437, id: 'Los Angeles', color: 'blue' },
  { latitude: 47.6062, longitude: -122.3321, id: 'Seattle', color: 'green' },
  { latitude: 45.5152, longitude: -122.6784, id: 'Portland', color: 'purple' },
]

function cityStyle(feature: Feature): Style {
  const color = String(feature.get('color'))
  return new Style({
    image: new CircleStyle({
      radius: 10,
      fill: new Fill({
        color:
          color === 'red'
            ? 'rgba(255, 0, 0, 0.85)'
            : color === 'blue'
              ? 'rgba(0, 0, 255, 0.85)'
              : color === 'green'
                ? 'rgba(0, 128, 0, 0.85)'
                : 'rgba(128, 0, 128, 0.85)',
      }),
      stroke: new Stroke({ color: 'black', width: 2 }),
    }),
  })
}

/** Browser port of examples/01_basic_map_with_markers.py. */
export function BasicMapExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null)
  const strokeInputRef = useRef<HTMLInputElement>(null)
  const baseLayerRef = useRef<TileLayer<OSM> | null>(null)
  const boundaryLayersRef = useRef<ReturnType<
    typeof createPackagedCountryLayers
  > | null>(null)
  const [countriesVisible, setCountriesVisible] = useState(false)
  const [baseVisible, setBaseVisible] = useState(true)
  const [blackBackground, setBlackBackground] = useState(false)
  const [strokeColor, setStrokeColor] = useState('#334155')
  const [boundaryError, setBoundaryError] = useState('')

  useEffect(() => {
    if (!mapTargetRef.current) return
    document.title = 'Basic Map with Markers'
    const boundaries = createPackagedCountryLayers(strokeColor)
    boundaryLayersRef.current = boundaries
    const baseLayer = new TileLayer({
      source: new OSM({ transition: 0 }),
    })
    baseLayerRef.current = baseLayer
    const citySource = new VectorSource({
      wrapX: true,
      features: CITIES.map((city) => {
        const feature = new Feature(
          new Point(fromLonLat([city.longitude, city.latitude]))
        )
        feature.setId(city.id)
        feature.setProperties(city)
        return feature
      }),
    })
    const cityLayer = new VectorLayer({
      source: citySource,
      style: (feature) => cityStyle(feature as Feature),
    })
    cityLayer.setZIndex(60)
    const map = new Map({
      target: mapTargetRef.current,
      layers: [
        boundaries.countries,
        boundaries.hydrology,
        baseLayer,
        cityLayer,
      ],
      view: new View({
        center: fromLonLat([-120, 37]),
        zoom: 6,
      }),
    })
    const coordinates = installReferenceCoordinateDisplay(
      map,
      mapTargetRef.current
    )
    map.addInteraction(
      new Select({
        layers: [cityLayer],
        condition: singleClick,
        toggleCondition: platformModifierKeyOnly,
        multi: true,
      })
    )
    return () => {
      coordinates.dispose()
      map.setTarget(undefined)
      boundaryLayersRef.current = null
      baseLayerRef.current = null
    }
  }, [])

  const toggleCountries = (visible: boolean): void => {
    setCountriesVisible(visible)
    setBoundaryError('')
    void boundaryLayersRef.current
      ?.setVisible(visible)
      .catch((error: unknown) => {
        setCountriesVisible(false)
        setBoundaryError(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <main className="reference-example-window">
      <section className="reference-controls-row" aria-label="Map controls">
        <label>
          <input
            type="checkbox"
            checked={countriesVisible}
            onChange={(event) => toggleCountries(event.target.checked)}
          />
          Show country boundaries
        </label>
        <label className="reference-inline-field">
          <span>Stroke:</span>
          <button type="button" onClick={() => strokeInputRef.current?.click()}>
            Pick color
          </button>
          <input
            ref={strokeInputRef}
            aria-label="Country boundary stroke color"
            className="reference-hidden-color-input"
            type="color"
            value={strokeColor}
            onChange={(event) => {
              const color = event.target.value
              setStrokeColor(color)
              boundaryLayersRef.current?.setStrokeColor(color)
            }}
          />
          <span
            className="reference-color-preview"
            style={{ backgroundColor: strokeColor }}
            aria-hidden="true"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={baseVisible}
            onChange={(event) => {
              setBaseVisible(event.target.checked)
              baseLayerRef.current?.setVisible(event.target.checked)
            }}
          />
          Show OSM
        </label>
        <label>
          <input
            type="checkbox"
            checked={blackBackground}
            onChange={(event) => {
              setBlackBackground(event.target.checked)
              if (mapTargetRef.current) {
                mapTargetRef.current.style.backgroundColor = event.target
                  .checked
                  ? '#000000'
                  : '#ffffff'
              }
            }}
          />
          Black background
        </label>
        {boundaryError && (
          <span className="reference-error" role="alert">
            {boundaryError}
          </span>
        )}
      </section>
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  )
}
