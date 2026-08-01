import {useEffect, useRef, useState} from "react";
import ImageLayer from "ol/layer/Image.js";
import TileLayer from "ol/layer/Tile.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import {transformExtent, fromLonLat} from "ol/proj.js";
import ImageStatic from "ol/source/ImageStatic.js";
import OSM from "ol/source/OSM.js";
import type {MaskShape} from "../lib/rasterMasks";
import {installQtCoordinateDisplay} from "../map/qtCoordinateDisplay";

type RasterResult = {
  type: "complete";
  requestId: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
};

const MASK_OPTIONS: readonly {value: MaskShape; label: string}[] = [
  {value: "rectangle", label: "Rectangle"},
  {value: "circle", label: "Circle"},
  {value: "triangle", label: "Triangle"},
  {value: "hexagon", label: "Hexagon"},
  {value: "star", label: "Star"},
  {value: "irregular", label: "Irregular"},
];

const MASKED_EXTENT = transformExtent(
  [-122.5, 37.7, -122.35, 37.85],
  "EPSG:4326",
  "EPSG:3857",
);
const REFERENCE_EXTENT = transformExtent(
  [-122.395, 37.7, -122.245, 37.85],
  "EPSG:4326",
  "EPSG:3857",
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

/**
 * Browser port of examples/05_raster_overlay.py.
 *
 * The Qt example always generates a square 512×512 image. Keeping that
 * invariant is important: deriving the raster dimensions from the viewport
 * changes every non-circular mask's aspect ratio.
 */
export function RasterOverlayExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const maskedLayerRef = useRef(new ImageLayer({opacity: 0.6}));
  const referenceLayerRef = useRef(new ImageLayer({opacity: 0.35}));
  const maskedWorkerRef = useRef<Worker | null>(null);
  const referenceWorkerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [maskedShape, setMaskedShape] = useState<MaskShape>("rectangle");
  const [referenceShape, setReferenceShape] =
    useState<MaskShape>("circle");
  const [maskedOpacity, setMaskedOpacity] = useState(0.6);
  const [referenceOpacity, setReferenceOpacity] = useState(0.35);

  const updateMasks = (): void => {
    const requestId = ++requestIdRef.current;
    maskedWorkerRef.current?.postMessage({
      type: "render",
      requestId,
      width: 512,
      height: 512,
      mask: maskedShape,
      profile: "qt05",
    });
    referenceWorkerRef.current?.postMessage({
      type: "render",
      requestId,
      width: 512,
      height: 512,
      mask: referenceShape,
      profile: "qt05",
    });
  };

  useEffect(() => {
    if (!mapTargetRef.current) return;
    document.title = "Raster Image Overlay with Polygon Masking";
    const maskedWorker = new Worker(
      new URL("../workers/raster.worker.ts", import.meta.url),
      {type: "module"},
    );
    const referenceWorker = new Worker(
      new URL("../workers/raster.worker.ts", import.meta.url),
      {type: "module"},
    );
    maskedWorkerRef.current = maskedWorker;
    referenceWorkerRef.current = referenceWorker;
    maskedWorker.onmessage = (event: MessageEvent<RasterResult>) => {
      if (
        event.data.type !== "complete" ||
        event.data.requestId !== requestIdRef.current
      ) return;
      maskedLayerRef.current.setSource(new ImageStatic({
        url: resultUrl(event.data),
        imageExtent: MASKED_EXTENT,
        projection: "EPSG:3857",
      }));
    };
    referenceWorker.onmessage = (event: MessageEvent<RasterResult>) => {
      if (
        event.data.type !== "complete" ||
        event.data.requestId !== requestIdRef.current
      ) return;
      referenceLayerRef.current.setSource(new ImageStatic({
        url: resultUrl(event.data),
        imageExtent: REFERENCE_EXTENT,
        projection: "EPSG:3857",
      }));
    };
    maskedLayerRef.current.setZIndex(10);
    referenceLayerRef.current.setZIndex(11);
    const map = new Map({
      target: mapTargetRef.current,
      layers: [
        new TileLayer({source: new OSM({transition: 0})}),
        maskedLayerRef.current,
        referenceLayerRef.current,
      ],
      view: new View({
        center: fromLonLat([-122.4194, 37.7749]),
        zoom: 10,
      }),
    });
    const coordinates = installQtCoordinateDisplay(
      map,
      mapTargetRef.current,
    );
    const requestId = ++requestIdRef.current;
    maskedWorker.postMessage({
      type: "render",
      requestId,
      width: 512,
      height: 512,
      mask: "rectangle",
      profile: "qt05",
    });
    referenceWorker.postMessage({
      type: "render",
      requestId,
      width: 512,
      height: 512,
      mask: "circle",
      profile: "qt05",
    });

    return () => {
      coordinates.dispose();
      maskedWorker.terminate();
      referenceWorker.terminate();
      maskedWorkerRef.current = null;
      referenceWorkerRef.current = null;
      map.setTarget(undefined);
    };
  }, []);

  return (
    <main className="qt-example-window">
      <section className="qt-raster-controls">
        <p>
          Demonstrate two polygon-masked raster images with 30% overlap.
          Choose a mask independently for each heatmap.
        </p>
        <fieldset>
          <legend>Polygon Masks</legend>
          <label>
            Masked:
            <select
              value={maskedShape}
              onChange={(event) =>
                setMaskedShape(event.target.value as MaskShape)
              }
            >
              {MASK_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reference:
            <select
              value={referenceShape}
              onChange={(event) =>
                setReferenceShape(event.target.value as MaskShape)
              }
            >
              {MASK_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={updateMasks}>Update Mask</button>
        </fieldset>
        <fieldset>
          <legend>Masked Heatmap Opacity</legend>
          <label>
            Opacity:
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={maskedOpacity}
              onChange={(event) => {
                const opacity = Number(event.target.value);
                setMaskedOpacity(opacity);
                maskedLayerRef.current.setOpacity(opacity);
              }}
            />
            <output>{maskedOpacity.toFixed(2)}</output>
          </label>
        </fieldset>
        <fieldset>
          <legend>Reference Heatmap Opacity</legend>
          <label>
            Opacity:
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={referenceOpacity}
              onChange={(event) => {
                const opacity = Number(event.target.value);
                setReferenceOpacity(opacity);
                referenceLayerRef.current.setOpacity(opacity);
              }}
            />
            <output>{referenceOpacity.toFixed(2)}</output>
          </label>
        </fieldset>
      </section>
      <div className="qt-map-fill" ref={mapTargetRef} />
    </main>
  );
}
