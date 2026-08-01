import {useEffect, useRef, useState} from "react";
import Feature from "ol/Feature.js";
import type {FeatureLike} from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import CircleGeometry from "ol/geom/Circle.js";
import LineString from "ol/geom/LineString.js";
import Point from "ol/geom/Point.js";
import Polygon from "ol/geom/Polygon.js";
import Draw from "ol/interaction/Draw.js";
import Modify from "ol/interaction/Modify.js";
import Select from "ol/interaction/Select.js";
import {platformModifierKeyOnly, singleClick} from "ol/events/condition.js";
import Translate from "ol/interaction/Translate.js";
import VectorLayer from "ol/layer/Vector.js";
import TileLayer from "ol/layer/Tile.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import {fromLonLat} from "ol/proj.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";
import {
  Circle as CircleStyle,
  Fill,
  Icon,
  Stroke,
  Style,
} from "ol/style.js";
import {
  CirclePlus,
  Edit3,
  Focus,
  Layers,
  MousePointer2,
  PaintBucket,
  Trash2,
} from "lucide-react";
import {gradientColor} from "../lib/colorPalettes";
import {loadPackagedGeoJson} from "../lib/packagedGeoJson";
import {DemoHeader} from "./DemoHeader";

const ICON_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><path fill="#f97316" stroke="#fff" stroke-width="2" d="M18 1C8.6 1 1 8.6 1 18c0 12 17 25 17 25s17-13 17-25C35 8.6 27.4 1 18 1z"/><circle cx="18" cy="18" r="6" fill="#071019"/></svg>',
);

function ellipse(center: [number, number], xRadius: number, yRadius: number) {
  const coordinates: [number, number][] = [];
  for (let step = 0; step <= 72; step += 1) {
    const angle = (step / 72) * Math.PI * 2;
    coordinates.push([
      center[0] + Math.cos(angle) * xRadius,
      center[1] + Math.sin(angle) * yRadius,
    ]);
  }
  return new Polygon([coordinates]);
}

function packedColor(value: number): string {
  const color = gradientColor(value, "turbo", 255);
  return `rgb(${(color >>> 24) & 255} ${(color >>> 16) & 255} ${(color >>> 8) & 255})`;
}

function geometryStyle(feature: FeatureLike): Style {
  const kind = String(feature.get("kind") ?? "");
  const color = String(feature.get("color") ?? "#38bdf8");
  if (kind === "icon") {
    return new Style({
      image: new Icon({
        src: `data:image/svg+xml;charset=utf-8,${ICON_SVG}`,
        anchor: [0.5, 1],
      }),
    });
  }
  if (kind === "gradient") {
    return new Style({
      stroke: new Stroke({
        color: String(feature.get("segmentColor")),
        width: 7,
      }),
    });
  }
  return new Style({
    image: new CircleStyle({
      radius: kind === "point" ? 8 : 6,
      fill: new Fill({color}),
      stroke: new Stroke({color: "#ffffff", width: 2}),
    }),
    fill: new Fill({color: `${color}44`}),
    stroke: new Stroke({color, width: 3}),
  });
}

function selectionStyle(feature: FeatureLike): Style {
  const base = geometryStyle(feature);
  return new Style({
    image: new CircleStyle({
      radius: 11,
      fill: new Fill({color: "#0e7490"}),
      stroke: new Stroke({color: "#67e8f9", width: 3}),
    }),
    fill: new Fill({color: "rgba(34, 211, 238, 0.28)"}),
    stroke: new Stroke({color: "#67e8f9", width: 5}),
    text: base.getText() ?? undefined,
  });
}

function hydrologyStyle(feature: FeatureLike): Style {
  const featureClass = String(feature.get("featurecla") ?? "").toLowerCase();
  const geometryType = feature.getGeometry()?.getType() ?? "";
  if (featureClass.includes("river")) {
    return new Style({
      stroke: new Stroke({color: "#1d4ed8", width: 1.5}),
    });
  }
  if (geometryType === "Polygon" || geometryType === "MultiPolygon") {
    return new Style({
      fill: new Fill({color: "rgba(59, 130, 246, 0.35)"}),
      stroke: new Stroke({color: "#2563eb", width: 1}),
    });
  }
  return new Style({
    stroke: new Stroke({color: "#2563eb", width: 2.5}),
  });
}

function demoFeatures(): Feature[] {
  const denver = fromLonLat([-104.99, 39.74]);
  const features: Feature[] = [];
  const point = new Feature(new Point(denver));
  point.setProperties({
    name: "Styled point",
    kind: "point",
    color: "#f43f5e",
    movable: true,
  });
  features.push(point);

  const icon = new Feature(new Point(fromLonLat([-100.3, 40.8])));
  icon.setProperties({
    name: "Data URL icon",
    kind: "icon",
    movable: true,
  });
  features.push(icon);

  const circle = new Feature(
    new CircleGeometry(fromLonLat([-111.8, 40.6]), 180_000),
  );
  circle.setProperties({
    name: "Geodesic-scale circle",
    kind: "circle",
    color: "#a855f7",
    movable: true,
  });
  features.push(circle);

  const line = new Feature(
    new LineString([
      fromLonLat([-122.4, 37.8]),
      fromLonLat([-116.2, 39.2]),
      fromLonLat([-110.5, 38.0]),
    ]),
  );
  line.setProperties({
    name: "Editable polyline",
    kind: "line",
    color: "#22c55e",
    movable: true,
  });
  features.push(line);

  const polygon = new Feature(
    new Polygon([[
      fromLonLat([-98.5, 32.2]),
      fromLonLat([-93.1, 33.1]),
      fromLonLat([-94.2, 37.4]),
      fromLonLat([-100.2, 36.7]),
      fromLonLat([-98.5, 32.2]),
    ]]),
  );
  polygon.setProperties({
    name: "Movable polygon",
    kind: "polygon",
    color: "#eab308",
    movable: true,
  });
  features.push(polygon);

  const ellipseFeature = new Feature(
    ellipse(
      fromLonLat([-87.5, 41.9]) as [number, number],
      320_000,
      120_000,
    ),
  );
  ellipseFeature.setProperties({
    name: "Uncertainty ellipse",
    kind: "ellipse",
    color: "#fb7185",
    movable: true,
  });
  features.push(ellipseFeature);

  const track = [
    [-123.0, 48.2],
    [-119.0, 46.0],
    [-114.0, 44.8],
    [-109.0, 46.3],
    [-103.0, 44.9],
  ] as [number, number][];
  for (let index = 1; index < track.length; index += 1) {
    const segment = new Feature(
      new LineString([
        fromLonLat(track[index - 1]),
        fromLonLat(track[index]),
      ]),
    );
    segment.setProperties({
      name: `Gradient segment ${index}`,
      kind: "gradient",
      segmentColor: packedColor((index - 1) / (track.length - 2)),
      movable: false,
    });
    features.push(segment);
  }
  return features;
}

export function VectorDemoApp() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const vectorSourceRef = useRef(new VectorSource());
  const countryLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const hydrologyLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const baseLayerRef = useRef<TileLayer<OSM> | null>(null);
  const boundaryLoadRef = useRef<Promise<void> | null>(null);
  const selectRef = useRef<Select | null>(null);
  const modifyRef = useRef<Modify | null>(null);
  const drawRef = useRef<Draw | null>(null);
  const [selectedName, setSelectedName] = useState("Nothing selected");
  const [selectedCount, setSelectedCount] = useState(0);
  const [baseVisible, setBaseVisible] = useState(true);
  const [countryVisible, setCountryVisible] = useState(false);
  const [boundaryStatus, setBoundaryStatus] =
    useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [modifyEnabled, setModifyEnabled] = useState(false);
  const [addEnabled, setAddEnabled] = useState(false);

  useEffect(() => {
    if (!mapRef.current) return;
    const vectorSource = vectorSourceRef.current;
    vectorSource.clear();
    vectorSource.addFeatures(demoFeatures());
    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: geometryStyle,
    });
    vectorLayer.setZIndex(60);

    // This mirrors ol_bridge.js: boundaries start hidden, load on demand, and
    // use transparent country fills plus a separately styled hydrology layer.
    const countrySource = new VectorSource();
    const countryLayer = new VectorLayer({
      source: countrySource,
      style: new Style({
        fill: new Fill({color: "rgba(0, 0, 0, 0)"}),
        stroke: new Stroke({color: "#334155", width: 1}),
      }),
      visible: false,
    });
    countryLayer.setZIndex(50);
    countryLayerRef.current = countryLayer;
    const hydrologyLayer = new VectorLayer({
      source: new VectorSource(),
      style: hydrologyStyle,
      visible: false,
    });
    hydrologyLayer.setZIndex(51);
    hydrologyLayerRef.current = hydrologyLayer;

    const baseLayer = new TileLayer({source: new OSM()});
    baseLayerRef.current = baseLayer;
    const map = new Map({
      target: mapRef.current,
      layers: [
        baseLayer,
        countryLayer,
        hydrologyLayer,
        vectorLayer,
      ],
      view: new View({
        center: fromLonLat([-103, 40]),
        zoom: 4,
      }),
    });
    mapInstanceRef.current = map;

    const select = new Select({
      layers: [vectorLayer],
      condition: singleClick,
      toggleCondition: platformModifierKeyOnly,
      multi: true,
      style: selectionStyle,
    });
    select.on("select", () => {
      const selected = select.getFeatures().item(0);
      setSelectedName(selected?.get("name") ?? "Nothing selected");
      setSelectedCount(select.getFeatures().getLength());
    });
    map.addInteraction(select);
    selectRef.current = select;

    const translate = new Translate({
      features: select.getFeatures(),
      filter: (feature) => feature.get("movable") !== false,
    });
    map.addInteraction(translate);

    const modify = new Modify({features: select.getFeatures()});
    modify.setActive(false);
    map.addInteraction(modify);
    modifyRef.current = modify;

    const draw = new Draw({source: vectorSource, type: "Point"});
    draw.setActive(false);
    draw.on("drawend", (event) => {
      event.feature.setProperties({
        name: `Added point ${vectorSource.getFeatures().length + 1}`,
        kind: "point",
        color: "#f97316",
        movable: true,
      });
    });
    map.addInteraction(draw);
    drawRef.current = draw;

    return () => {
      map.setTarget(undefined);
      mapInstanceRef.current = null;
    };
  }, []);

  const loadBoundaries = (): Promise<void> => {
    if (boundaryLoadRef.current) return boundaryLoadRef.current;
    setBoundaryStatus("loading");
    const promise = Promise.all([
      loadPackagedGeoJson("countries"),
      loadPackagedGeoJson("lakes"),
    ])
      .then(([countries, lakes]) => {
        const format = new GeoJSON();
        countryLayerRef.current?.getSource()?.addFeatures(
          format.readFeatures(countries, {featureProjection: "EPSG:3857"}),
        );
        hydrologyLayerRef.current?.getSource()?.addFeatures(
          format.readFeatures(lakes, {featureProjection: "EPSG:3857"}),
        );
        setBoundaryStatus("loaded");
      })
      .catch((error: unknown) => {
        setBoundaryStatus("error");
        boundaryLoadRef.current = null;
        throw error;
      });
    boundaryLoadRef.current = promise;
    return promise;
  };

  const recolor = (color: string): void => {
    const selected = selectRef.current?.getFeatures().getArray() ?? [];
    for (const feature of selected) {
      feature.set("color", color);
      feature.changed();
    }
  };

  return (
    <div className="demo-app">
      <DemoHeader
        title="Vector geometry and editing"
        description="Markers, icons, circles, lines, polygons, ellipses, gradient tracks, selection, recoloring, and movement."
        useCases={[1, 2, 7, 8, 9, 18, 21]}
      />
      <div className="demo-toolbar">
        <button
          className="tool-button"
          onClick={() => {
            const extent = vectorSourceRef.current.getExtent();
            if (extent) {
              mapInstanceRef.current?.getView().fit(extent, {
                padding: [70, 70, 70, 70],
                duration: 250,
              });
            }
          }}
        >
          <Focus size={15} /> Fit features
        </button>
        <button
          className={`tool-button ${addEnabled ? "is-active" : ""}`}
          onClick={() => {
            const enabled = !addEnabled;
            setAddEnabled(enabled);
            drawRef.current?.setActive(enabled);
          }}
        >
          <CirclePlus size={15} /> Add point
        </button>
        <button
          className={`tool-button ${modifyEnabled ? "is-active" : ""}`}
          onClick={() => {
            const enabled = !modifyEnabled;
            setModifyEnabled(enabled);
            modifyRef.current?.setActive(enabled);
          }}
        >
          <Edit3 size={15} /> Modify vertices
        </button>
        <button
          className="tool-button"
          disabled={selectedCount === 0}
          onClick={() => {
            const selection = selectRef.current?.getFeatures();
            if (!selection) return;
            for (const feature of [...selection.getArray()]) {
              vectorSourceRef.current.removeFeature(feature);
            }
            selection.clear();
            setSelectedCount(0);
            setSelectedName("Nothing selected");
          }}
        >
          <Trash2 size={15} /> Delete selected
        </button>
        <button
          className={`tool-button ${baseVisible ? "is-active" : ""}`}
          onClick={() => {
            const visible = !baseVisible;
            setBaseVisible(visible);
            baseLayerRef.current?.setVisible(visible);
          }}
        >
          <Layers size={15} /> Base map
        </button>
        <button
          className={`tool-button ${countryVisible ? "is-active" : ""}`}
          onClick={() => {
            const visible = !countryVisible;
            setCountryVisible(visible);
            countryLayerRef.current?.setVisible(visible);
            hydrologyLayerRef.current?.setVisible(visible);
            if (visible && boundaryStatus !== "loaded") {
              void loadBoundaries().catch(() => {
                countryLayerRef.current?.setVisible(false);
                hydrologyLayerRef.current?.setVisible(false);
                setCountryVisible(false);
              });
            }
          }}
        >
          Country boundaries
          {boundaryStatus === "loading" ? " (loading…)" : ""}
        </button>
      </div>
      <main className="demo-content">
        <div className="demo-map">
          <div className="demo-map-target" ref={mapRef} />
          <div className="demo-overlay-note">
            Click to select · drag selected features to move · gradient track is fixed
          </div>
        </div>
        <aside className="demo-sidebar">
          <section className="demo-status-card">
            <MousePointer2 size={17} />
            <strong>{selectedName}</strong>
            <p>Select any movable feature, then drag it. Enable Modify vertices for line and polygon handles.</p>
          </section>
          <section>
            <h2><PaintBucket size={14} /> Recolor selection</h2>
            <div className="demo-color-buttons">
              {["#ef4444", "#f97316", "#eab308", "#22c55e", "#38bdf8", "#a855f7"].map(
                (color) => (
                  <button
                    className="demo-color-button"
                    style={{background: color}}
                    aria-label={`Recolor selection ${color}`}
                    key={color}
                    onClick={() => recolor(color)}
                  />
                ),
              )}
            </div>
          </section>
          <section>
            <h2>Included geometry</h2>
            <ul>
              <li>Styled point and a data-URL icon marker</li>
              <li>Map-unit circle and uncertainty ellipse</li>
              <li>Editable polyline and polygon</li>
              <li>Turbo-colored per-segment track</li>
              <li>
                Packaged Natural Earth countries and hydrology
                {boundaryStatus === "error" ? " (load failed)" : ""}
              </li>
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}
