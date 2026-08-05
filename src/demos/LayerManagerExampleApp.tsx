import {useEffect, useRef, useState} from "react";
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import VectorLayer from "ol/layer/Vector.js";
import TileLayer from "ol/layer/Tile.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import {fromLonLat} from "ol/proj.js";
import OSM from "ol/source/OSM.js";
import TileWMS from "ol/source/TileWMS.js";
import VectorSource from "ol/source/Vector.js";
import XYZ from "ol/source/XYZ.js";
import {
  Circle as CircleStyle,
  Fill,
  Stroke,
  Style,
} from "ol/style.js";
import {installReferenceCoordinateDisplay} from "../map/referenceCoordinateDisplay";

const DEFAULT_OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ALT_OSM_URL = "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png";
const AWS_TERRAIN_URL =
  "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";

/** Browser port of examples/04_wms_and_base_layers.py. */
export function LayerManagerExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const baseLayerRef = useRef<TileLayer<OSM> | null>(null);
  const tileLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const wmsLayerRef = useRef<TileLayer<TileWMS> | null>(null);
  const [tileUrl, setTileUrl] = useState(DEFAULT_OSM_URL);
  const [wmsDataset, setWmsDataset] = useState("topp:states");
  const [baseVisible, setBaseVisible] = useState(true);
  const [tileVisible, setTileVisible] = useState(true);
  const [wmsVisible, setWmsVisible] = useState(true);
  const [baseOpacity, setBaseOpacity] = useState(1);
  const [tileOpacity, setTileOpacity] = useState(0.6);
  const [wmsOpacity, setWmsOpacity] = useState(0.7);

  useEffect(() => {
    if (!mapTargetRef.current) return;
    document.title = "Layer Manager: OSM + Generic Tile + WMS";
    const baseLayer = new TileLayer({
      source: new OSM({url: DEFAULT_OSM_URL, transition: 0}),
    });
    const tileLayer = new TileLayer({
      source: new XYZ({
        url: DEFAULT_OSM_URL,
        attributions: "Managed generic tile layer",
        transition: 0,
      }),
      opacity: 0.6,
    });
    const wmsLayer = new TileLayer({
      source: new TileWMS({
        url: "https://ahocevar.com/geoserver/wms",
        params: {
          LAYERS: "topp:states",
          FORMAT: "image/png",
          TRANSPARENT: "TRUE",
          TILED: true,
        },
        transition: 0,
      }),
      opacity: 0.7,
    });
    baseLayerRef.current = baseLayer;
    tileLayerRef.current = tileLayer;
    wmsLayerRef.current = wmsLayer;
    const capitalFeatures = [
      [38.9072, -77.0369, "Washington DC"],
      [33.4484, -112.074, "Phoenix"],
      [39.7392, -104.9903, "Denver"],
    ].map(([latitude, longitude, name]) => {
      const feature = new Feature(
        new Point(fromLonLat([Number(longitude), Number(latitude)])),
      );
      feature.setId(String(name));
      return feature;
    });
    const markerLayer = new VectorLayer({
      source: new VectorSource({features: capitalFeatures}),
      style: new Style({
        image: new CircleStyle({
          radius: 8,
          fill: new Fill({color: "red"}),
          stroke: new Stroke({color: "darkred", width: 2}),
        }),
      }),
    });
    const map = new Map({
      target: mapTargetRef.current,
      layers: [baseLayer, tileLayer, wmsLayer, markerLayer],
      view: new View({center: fromLonLat([-98, 39]), zoom: 4}),
    });
    const coordinates = installReferenceCoordinateDisplay(
      map,
      mapTargetRef.current,
    );
    return () => {
      coordinates.dispose();
      map.setTarget(undefined);
      baseLayerRef.current = null;
      tileLayerRef.current = null;
      wmsLayerRef.current = null;
    };
  }, []);

  return (
    <main className="reference-example-window">
      <section className="reference-layer-controls">
        <fieldset>
          <legend>Generic Tile Source</legend>
          <label>
            URL:
            <input
              value={tileUrl}
              onChange={(event) => setTileUrl(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => setTileUrl(ALT_OSM_URL)}>
            Use Alt OSM URL
          </button>
          <button type="button" onClick={() => setTileUrl(AWS_TERRAIN_URL)}>
            Use Terrain URL
          </button>
          <button
            type="button"
            onClick={() =>
              tileLayerRef.current?.setSource(new XYZ({
                url: tileUrl.trim() || DEFAULT_OSM_URL,
                attributions: "Managed generic tile layer",
                transition: 0,
              }))
            }
          >
            Apply to Generic Tile Layer
          </button>
        </fieldset>
        <fieldset>
          <legend>WMS Source</legend>
          <label>
            Dataset:
            <select
              value={wmsDataset}
              onChange={(event) => {
                const dataset = event.target.value;
                setWmsDataset(dataset);
                wmsLayerRef.current?.getSource()?.updateParams({
                  LAYERS: dataset,
                  FORMAT: "image/png",
                  TRANSPARENT: "TRUE",
                });
              }}
            >
              <option value="topp:states">US States (topp:states)</option>
              <option value="topp:tasmania_water_bodies">
                Tasmania Water Bodies (topp:tasmania_water_bodies)
              </option>
            </select>
          </label>
        </fieldset>
        <fieldset className="reference-layer-grid">
          <legend>Layers</legend>
          <strong>Layer</strong><strong>Visible</strong>
          <strong>Opacity</strong><strong>Value</strong>
          <span>Base OSM</span>
          <input
            aria-label="Base OSM visible"
            type="checkbox"
            checked={baseVisible}
            onChange={(event) => {
              setBaseVisible(event.target.checked);
              baseLayerRef.current?.setVisible(event.target.checked);
            }}
          />
          <input
            aria-label="Base OSM opacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={baseOpacity}
            onChange={(event) => {
              const opacity = Number(event.target.value);
              setBaseOpacity(opacity);
              baseLayerRef.current?.setOpacity(opacity);
            }}
          />
          <output>{baseOpacity.toFixed(2)}</output>
          <span>Generic Tile</span>
          <input
            aria-label="Generic tile visible"
            type="checkbox"
            checked={tileVisible}
            onChange={(event) => {
              setTileVisible(event.target.checked);
              tileLayerRef.current?.setVisible(event.target.checked);
            }}
          />
          <input
            aria-label="Generic tile opacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={tileOpacity}
            onChange={(event) => {
              const opacity = Number(event.target.value);
              setTileOpacity(opacity);
              tileLayerRef.current?.setOpacity(opacity);
            }}
          />
          <output>{tileOpacity.toFixed(2)}</output>
          <span>WMS Overlay</span>
          <input
            aria-label="WMS visible"
            type="checkbox"
            checked={wmsVisible}
            onChange={(event) => {
              setWmsVisible(event.target.checked);
              wmsLayerRef.current?.setVisible(event.target.checked);
            }}
          />
          <input
            aria-label="WMS opacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={wmsOpacity}
            onChange={(event) => {
              const opacity = Number(event.target.value);
              setWmsOpacity(opacity);
              wmsLayerRef.current?.setOpacity(opacity);
            }}
          />
          <output>{wmsOpacity.toFixed(2)}</output>
        </fieldset>
      </section>
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  );
}
