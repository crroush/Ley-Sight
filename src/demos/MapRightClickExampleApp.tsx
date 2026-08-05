import {useEffect, useRef, useState} from "react";
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import VectorLayer from "ol/layer/Vector.js";
import TileLayer from "ol/layer/Tile.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import {fromLonLat, toLonLat} from "ol/proj.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";
import {
  Circle as CircleStyle,
  Fill,
  Stroke,
  Style,
} from "ol/style.js";
import {installReferenceCoordinateDisplay} from "../map/referenceCoordinateDisplay";

type MenuState = {
  left: number;
  top: number;
  coordinate: [number, number];
  featureId: string | null;
};

function pointStyle(feature: Feature): Style {
  return new Style({
    image: new CircleStyle({
      radius: Number(feature.get("radius") ?? 6),
      fill: new Fill({color: String(feature.get("color") ?? "#1f77b4")}),
      stroke: new Stroke({color: "rgba(0, 0, 0, 0.7)", width: 1}),
    }),
  });
}

function coordinateText(coordinate: [number, number]): string {
  const [longitude, latitude] = toLonLat(coordinate);
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

/** Browser port of examples/17_map_right_click_context_menu.py. */
export function MapRightClickExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef(new VectorSource());
  const pointCounterRef = useRef(3);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!mapTargetRef.current) return;
    document.title = "Map Right-Click Context Menu Demo";
    const source = sourceRef.current;
    source.clear();
    [
      [37.7749, -122.4194],
      [37.7845, -122.4091],
      [37.7682, -122.4319],
    ].forEach(([latitude, longitude], index) => {
      const feature = new Feature(new Point(fromLonLat([longitude, latitude])));
      feature.setId(`pt_${index + 1}`);
      feature.setProperties({color: "#1f77b4", radius: 6});
      source.addFeature(feature);
    });
    const layer = new VectorLayer({
      source,
      style: (feature) => pointStyle(feature as Feature),
    });
    const map = new Map({
      target: mapTargetRef.current,
      layers: [new TileLayer({source: new OSM({transition: 0})}), layer],
      view: new View({
        center: fromLonLat([-122.4194, 37.7749]),
        zoom: 11,
      }),
    });
    const coordinates = installReferenceCoordinateDisplay(
      map,
      mapTargetRef.current,
    );
    const viewport = map.getViewport();
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      const pixel = map.getEventPixel(event);
      const coordinate = map.getCoordinateFromPixel(pixel) as [number, number];
      const feature = map.forEachFeatureAtPixel(pixel, (candidate) => candidate);
      const bounds = mapContainerRef.current?.getBoundingClientRect();
      setMenu({
        left: event.clientX - (bounds?.left ?? 0),
        top: event.clientY - (bounds?.top ?? 0),
        coordinate,
        featureId: feature?.getId() == null ? null : String(feature.getId()),
      });
    };
    const close = (): void => setMenu(null);
    viewport.addEventListener("contextmenu", onContextMenu);
    map.on("movestart", close);
    return () => {
      coordinates.dispose();
      viewport.removeEventListener("contextmenu", onContextMenu);
      map.un("movestart", close);
      map.setTarget(undefined);
    };
  }, []);

  const createPoint = (): void => {
    if (!menu) return;
    pointCounterRef.current += 1;
    const feature = new Feature(new Point(menu.coordinate));
    feature.setId(`pt_${pointCounterRef.current}`);
    feature.setProperties({color: "#2ca02c", radius: 6.5});
    sourceRef.current.addFeature(feature);
    setMenu(null);
  };

  const openPoint = (): void => {
    if (!menu?.featureId) return;
    const [longitude, latitude] = toLonLat(menu.coordinate);
    window.alert(
      `Feature: ${menu.featureId}\nLatitude: ${latitude.toFixed(6)}\nLongitude: ${longitude.toFixed(6)}`,
    );
    setMenu(null);
  };

  const copyCoordinate = async (): Promise<void> => {
    if (!menu) return;
    const text = coordinateText(menu.coordinate);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy coordinates", text);
    }
    setMenu(null);
  };

  return (
    <main className="reference-example-window">
      <div className="reference-map-fill reference-context-map" ref={mapContainerRef}>
        <div className="reference-map-target-fill" ref={mapTargetRef} />
        {menu && (
          <div
            className="reference-context-menu"
            style={{left: menu.left, top: menu.top}}
            role="menu"
          >
            <button role="menuitem" onClick={createPoint}>
              Create point here
            </button>
            {menu.featureId && (
              <button role="menuitem" onClick={openPoint}>
                Open dialog for point {menu.featureId}
              </button>
            )}
            <hr />
            <button role="menuitem" onClick={copyCoordinate}>
              Copy coordinates
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
