import {useEffect, useRef, useState} from 'react';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import VectorLayer from 'ol/layer/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {fromLonLat, toLonLat} from 'ol/proj.js';
import OSM from 'ol/source/OSM.js';
import VectorSource from 'ol/source/Vector.js';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style.js';
import {Crosshair, MapPin, MousePointerClick, Trash2} from 'lucide-react';
import {DemoHeader} from './DemoHeader';

type ContextMenuState = {
  left: number;
  top: number;
  coordinate: [number, number];
  featureName: string | null;
};

function markerStyle(feature: Feature): Style {
  const priority = feature.get('priority') === true;
  return new Style({
    image: new CircleStyle({
      radius: priority ? 9 : 7,
      fill: new Fill({color: priority ? '#f97316' : '#fde047'}),
      stroke: new Stroke({
        color: priority ? '#7c2d12' : '#713f12',
        width: 2,
      }),
    }),
  });
}

function formatCoordinate(coordinate: [number, number]): string {
  const [longitude, latitude] = toLonLat(coordinate);
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function MapEventsDemoApp() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const sourceRef = useRef(new VectorSource());
  const heldKeysRef = useRef(new Set<string>());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [status, setStatus] = useState(
    'Right-click anywhere, or hold T while clicking the map.'
  );
  const [pointCount, setPointCount] = useState(0);

  useEffect(() => {
    if (!mapRef.current) return;
    const source = sourceRef.current;
    source.clear();
    const vectorLayer = new VectorLayer({
      source,
      style: (feature) => markerStyle(feature as Feature),
    });
    vectorLayer.setZIndex(3);
    const map = new Map({
      target: mapRef.current,
      layers: [new TileLayer({source: new OSM()}), vectorLayer],
      view: new View({
        center: fromLonLat([-101, 39]),
        zoom: 4,
      }),
    });
    mapInstanceRef.current = map;

    const addTarget = (
      coordinate: [number, number],
      priority: boolean
    ): void => {
      const feature = new Feature(new Point(coordinate));
      const nextNumber = source.getFeatures().length + 1;
      feature.setProperties({
        name: `${priority ? 'Priority' : 'Standard'} target ${nextNumber}`,
        priority,
      });
      source.addFeature(feature);
      setPointCount(source.getFeatures().length);
      setStatus(
        `${feature.get('name')} added at ${formatCoordinate(coordinate)}.`
      );
    };

    map.on('singleclick', (event) => {
      setContextMenu(null);
      const coordinate = event.coordinate as [number, number];
      if (heldKeysRef.current.has('t')) {
        const mouseEvent = event.originalEvent as MouseEvent;
        addTarget(coordinate, mouseEvent.shiftKey);
        return;
      }
      setStatus(`Map click at ${formatCoordinate(coordinate)}.`);
    });

    const viewport = map.getViewport();
    const openContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      const pixel = map.getEventPixel(event);
      const coordinate = map.getCoordinateFromPixel(pixel) as [number, number];
      const feature = map.forEachFeatureAtPixel(
        pixel,
        (candidate) => candidate
      );
      const rect = mapRef.current?.getBoundingClientRect();
      setContextMenu({
        left: event.clientX - (rect?.left ?? 0),
        top: event.clientY - (rect?.top ?? 0),
        coordinate,
        featureName: feature ? String(feature.get('name')) : null,
      });
    };
    const closeContextMenu = (): void => setContextMenu(null);
    const keyDown = (event: KeyboardEvent): void => {
      // Normalize held keys once; map click bindings can then combine them
      // with click modifiers. Shift is used because browsers reserve Ctrl+T.
      heldKeysRef.current.add(event.key.toLowerCase());
    };
    const keyUp = (event: KeyboardEvent): void => {
      heldKeysRef.current.delete(event.key.toLowerCase());
    };
    const clearHeldKeys = (): void => heldKeysRef.current.clear();
    viewport.addEventListener('contextmenu', openContextMenu);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearHeldKeys);
    map.on('movestart', closeContextMenu);

    return () => {
      viewport.removeEventListener('contextmenu', openContextMenu);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clearHeldKeys);
      map.un('movestart', closeContextMenu);
      map.setTarget(undefined);
      mapInstanceRef.current = null;
    };
  }, []);

  const addContextPoint = (): void => {
    if (!contextMenu) return;
    const source = sourceRef.current;
    const feature = new Feature(new Point(contextMenu.coordinate));
    feature.setProperties({
      name: `Context point ${source.getFeatures().length + 1}`,
      priority: false,
    });
    source.addFeature(feature);
    setPointCount(source.getFeatures().length);
    setStatus(
      `${feature.get('name')} added at ${formatCoordinate(contextMenu.coordinate)}.`
    );
    setContextMenu(null);
  };

  const inspectContext = (): void => {
    if (!contextMenu) return;
    setStatus(
      contextMenu.featureName
        ? `Feature: ${contextMenu.featureName} · ${formatCoordinate(contextMenu.coordinate)}.`
        : `No feature at ${formatCoordinate(contextMenu.coordinate)}.`
    );
    setContextMenu(null);
  };

  const copyContextCoordinate = async (): Promise<void> => {
    if (!contextMenu) return;
    const coordinateText = formatCoordinate(contextMenu.coordinate);
    if (!navigator.clipboard) {
      setStatus(`Clipboard unavailable. Coordinate: ${coordinateText}.`);
      setContextMenu(null);
      return;
    }
    try {
      await navigator.clipboard.writeText(coordinateText);
      setStatus(`Copied ${coordinateText}.`);
    } catch {
      setStatus(`Copy blocked by the browser. Coordinate: ${coordinateText}.`);
    }
    setContextMenu(null);
  };

  return (
    <div className="demo-app">
      <DemoHeader
        title="Map events and context actions"
        description="Typed right-click actions and browser-safe held-key/modifier bindings."
        useCases={[17, 22]}
      />
      <div className="demo-toolbar">
        <button
          className="tool-button"
          disabled={pointCount === 0}
          onClick={() => {
            sourceRef.current.clear();
            setPointCount(0);
            setStatus('All target points cleared.');
          }}
        >
          <Trash2 size={15} /> Clear points
        </button>
        <span className="linked-summary">{pointCount} target points</span>
      </div>
      <main className="demo-content">
        <div className="demo-map">
          <div className="demo-map-target" ref={mapRef} />
          <div className="demo-overlay-note">
            Right-click for actions · T + click · Shift+T + click for priority
          </div>
          {contextMenu && (
            <div
              className="map-context-menu"
              style={{left: contextMenu.left, top: contextMenu.top}}
              role="menu"
            >
              <div>
                {contextMenu.featureName ?? 'Map coordinate'}
                <small>{formatCoordinate(contextMenu.coordinate)}</small>
              </div>
              <button role="menuitem" onClick={addContextPoint}>
                <MapPin size={13} /> Create point here
              </button>
              <button role="menuitem" onClick={inspectContext}>
                <Crosshair size={13} /> Inspect target
              </button>
              <button role="menuitem" onClick={copyContextCoordinate}>
                Copy coordinates
              </button>
            </div>
          )}
        </div>
        <aside className="demo-sidebar">
          <section className="demo-status-card">
            <MousePointerClick size={17} />
            <strong>Latest event</strong>
            <p>{status}</p>
          </section>
          <section>
            <h2>Binding registry</h2>
            <ul>
              <li>Click: report map coordinate.</li>
              <li>T + click: create a standard target.</li>
              <li>Shift + T + click: create a priority target.</li>
              <li>Right-click: coordinate and feature action menu.</li>
            </ul>
            <p>
              Desktop shells can own Ctrl+T. Normal browsers reserve it for New
              Tab, so this web example uses Shift+T.
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}
