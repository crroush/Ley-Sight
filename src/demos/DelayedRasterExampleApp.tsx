import {useEffect, useRef, useState} from "react";
import ImageLayer from "ol/layer/Image.js";
import TileLayer from "ol/layer/Tile.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import {fromLonLat, transformExtent} from "ol/proj.js";
import ImageStatic from "ol/source/ImageStatic.js";
import OSM from "ol/source/OSM.js";
import {installReferenceCoordinateDisplay} from "../map/referenceCoordinateDisplay";

type RasterResult = {
  type: "complete";
  requestId: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  elapsedMs: number;
};

const POLYGON_BOUNDS = {
  latitudeMinimum: 37.682,
  longitudeMinimum: -122.545,
  latitudeMaximum: 37.845,
  longitudeMaximum: -122.340,
} as const;
const RASTER_EXTENT = transformExtent(
  [
    POLYGON_BOUNDS.longitudeMinimum,
    POLYGON_BOUNDS.latitudeMinimum,
    POLYGON_BOUNDS.longitudeMaximum,
    POLYGON_BOUNDS.latitudeMaximum,
  ],
  "EPSG:4326",
  "EPSG:3857",
);

function haversine(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const radians = Math.PI / 180;
  const phi1 = latitude1 * radians;
  const phi2 = latitude2 * radians;
  const deltaPhi = (latitude2 - latitude1) * radians;
  const deltaLambda = (longitude2 - longitude1) * radians;
  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

const MID_LATITUDE =
  (POLYGON_BOUNDS.latitudeMinimum + POLYGON_BOUNDS.latitudeMaximum) / 2;
const MID_LONGITUDE =
  (POLYGON_BOUNDS.longitudeMinimum + POLYGON_BOUNDS.longitudeMaximum) / 2;
const POLYGON_WIDTH_METERS = haversine(
  MID_LATITUDE,
  POLYGON_BOUNDS.longitudeMinimum,
  MID_LATITUDE,
  POLYGON_BOUNDS.longitudeMaximum,
);
const POLYGON_HEIGHT_METERS = haversine(
  POLYGON_BOUNDS.latitudeMinimum,
  MID_LONGITUDE,
  POLYGON_BOUNDS.latitudeMaximum,
  MID_LONGITUDE,
);

function resultUrl(result: RasterResult): string {
  const canvas = document.createElement("canvas");
  canvas.width = result.width;
  canvas.height = result.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable.");
  context.putImageData(
    new ImageData(result.pixels, result.width, result.height),
    0,
    0,
  );
  return canvas.toDataURL("image/png");
}

/** Source-matched port of examples/14_delayed_render_interrupt.py. */
export function DelayedRasterExampleApp() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const rasterLayerRef = useRef(new ImageLayer({opacity: 0.74}));
  const workerRef = useRef<Worker | null>(null);
  const viewDebounceRef = useRef<number | null>(null);
  const renderDebounceRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const activeRef = useRef(false);
  const qualityRef = useRef(3);
  const interruptsRef = useRef(0);
  const renderKeyRef = useRef("");
  const [quality, setQuality] = useState(3);
  const [status, setStatus] = useState("Waiting for first extent...");

  const beginRender = (): void => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const size = map.getSize() ?? [1024, 768];
    const resolution = Math.max(
      1e-9,
      map.getView().getResolution() ?? 1,
    );
    const width = Math.max(
      180,
      Math.min(1600, Math.trunc(POLYGON_WIDTH_METERS / resolution)),
    );
    const height = Math.max(
      180,
      Math.min(1600, Math.trunc(POLYGON_HEIGHT_METERS / resolution)),
    );
    const metersPerLongitudeDegree = Math.max(
      1,
      111_320 * Math.cos(MID_LATITUDE * Math.PI / 180),
    );
    const qLon = Math.max(1e-12, resolution * 6 / metersPerLongitudeDegree);
    const qLat = Math.max(1e-12, resolution * 6 / 110_540);
    const renderKey = [
      width,
      height,
      resolution.toFixed(6),
      Math.trunc(size[0]),
      Math.trunc(size[1]),
      qualityRef.current,
    ].join(":");
    if (renderKey === renderKeyRef.current) {
      setStatus(
        `⏸ skipped (pan/no resolution change) | raster=${width}x${height}px ` +
        `| res≈${resolution.toFixed(3)} m/px | bin≈${qLon.toFixed(6)}°, ` +
        `${qLat.toFixed(6)}° | interrupts=${interruptsRef.current}`,
      );
      return;
    }
    renderKeyRef.current = renderKey;

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      if (activeRef.current) interruptsRef.current += 1;
    }
    const worker = new Worker(
      new URL("../workers/raster.worker.ts", import.meta.url),
      {type: "module"},
    );
    workerRef.current = worker;
    activeRef.current = true;
    const requestId = ++requestRef.current;
    worker.onmessage = (event: MessageEvent<RasterResult>) => {
      if (
        event.data.type !== "complete" ||
        event.data.requestId !== requestRef.current
      ) return;
      activeRef.current = false;
      rasterLayerRef.current.setSource(new ImageStatic({
        url: resultUrl(event.data),
        imageExtent: RASTER_EXTENT,
        projection: "EPSG:3857",
      }));
      setStatus(
        `✅ updated req#${requestId} in ${(event.data.elapsedMs / 1000).toFixed(2)}s ` +
        `| raster=${event.data.width}x${event.data.height}px ` +
        `| quality=${qualityRef.current} | bin≈${qLon.toFixed(6)}°, ` +
        `${qLat.toFixed(6)}° | interrupts=${interruptsRef.current}`,
      );
    };
    worker.onerror = () => {
      activeRef.current = false;
      setStatus(`❌ render #${requestId} failed`);
    };
    worker.postMessage({
      type: "render",
      requestId,
      width,
      height,
      mask: "irregular",
      profile: "reference14",
      quality: qualityRef.current,
      qLon,
      qLat,
    });
    setStatus(
      `⏳ recomputing req#${requestId} | target=${width}x${height}px ` +
      `| view=${Math.trunc(size[0])}x${Math.trunc(size[1])}px ` +
      `| res≈${resolution.toFixed(3)} m/px | bin≈${qLon.toFixed(6)}°, ` +
      `${qLat.toFixed(6)}° | interrupts=${interruptsRef.current}`,
    );
  };

  const scheduleRender = (): void => {
    if (renderDebounceRef.current != null) {
      window.clearTimeout(renderDebounceRef.current);
    }
    renderDebounceRef.current = window.setTimeout(beginRender, 220);
  };

  const scheduleViewExtent = (): void => {
    if (viewDebounceRef.current != null) {
      window.clearTimeout(viewDebounceRef.current);
    }
    viewDebounceRef.current = window.setTimeout(scheduleRender, 250);
  };

  useEffect(() => {
    if (!mapRef.current) return;
    document.title = "Delayed Raster Render with Debounce + Interrupt";
    rasterLayerRef.current.setZIndex(10);
    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({source: new OSM({transition: 0})}),
        rasterLayerRef.current,
      ],
      view: new View({
        center: fromLonLat([-122.4194, 37.7749]),
        zoom: 10,
      }),
    });
    const coordinates = installReferenceCoordinateDisplay(
      map,
      mapRef.current,
    );
    mapInstanceRef.current = map;
    map.on("moveend", scheduleViewExtent);
    scheduleViewExtent();
    return () => {
      coordinates.dispose();
      if (viewDebounceRef.current != null) {
        window.clearTimeout(viewDebounceRef.current);
      }
      if (renderDebounceRef.current != null) {
        window.clearTimeout(renderDebounceRef.current);
      }
      workerRef.current?.terminate();
      workerRef.current = null;
      map.setTarget(undefined);
      mapInstanceRef.current = null;
    };
  }, []);

  return (
    <main className="reference-example-window">
      <section className="reference-delayed-raster-controls">
        <p>
          Fixed geographic heatmap footprint. Zooming changes computed raster
          pixel dimensions (shown in status + image stamp).
        </p>
        <fieldset>
          <legend>Compute</legend>
          <label>
            Quality:
            <input
              type="number"
              min="1"
              max="5"
              value={quality}
              onChange={(event) => {
                const next = Math.max(1, Math.min(5, Number(event.target.value)));
                qualityRef.current = next;
                setQuality(next);
                scheduleRender();
              }}
            />
          </label>
        </fieldset>
        <strong>{status}</strong>
      </section>
      <div className="reference-map-fill" ref={mapRef} />
    </main>
  );
}
