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

function targetStyle(feature: Feature): Style {
  return new Style({
    image: new CircleStyle({
      radius: 7,
      fill: new Fill({color: String(feature.get('color'))}),
      stroke: new Stroke({color: '#111111', width: 2}),
    }),
  });
}

/** Browser port of examples/22_modified_map_clicks.py. */
export function ModifiedMapClicksExampleApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const targetSourceRef = useRef(new VectorSource());
  const targetCountRef = useRef(0);
  const heldKeysRef = useRef(new Set<string>());
  const clickKeysRef = useRef(new WeakMap<Event, string[]>());
  const [status, setStatus] = useState('Click the map to begin.');

  useEffect(() => {
    if (!mapTargetRef.current) return;
    document.title = 'Modified Map Click Demo';
    const targetLayer = new VectorLayer({
      source: targetSourceRef.current,
      style: (feature) => targetStyle(feature as Feature),
    });
    const map = new Map({
      target: mapTargetRef.current,
      layers: [new TileLayer({source: new OSM({transition: 0})}), targetLayer],
      view: new View({
        center: fromLonLat([-122.4194, 37.7749]),
        zoom: 11,
      }),
    });
    const viewport = map.getViewport();
    viewport.tabIndex = 0;
    const focusMap = (): void => viewport.focus();
    const keyDown = (event: KeyboardEvent): void => {
      heldKeysRef.current.add(event.key.toLowerCase());
    };
    const keyUp = (event: KeyboardEvent): void => {
      heldKeysRef.current.delete(event.key.toLowerCase());
    };
    const clearKeys = (): void => heldKeysRef.current.clear();
    viewport.addEventListener('pointerdown', focusMap);
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', keyUp, true);
    window.addEventListener('blur', clearKeys);

    map.on('click', (event) => {
      if (event.originalEvent) {
        clickKeysRef.current.set(
          event.originalEvent,
          Array.from(heldKeysRef.current)
        );
      }
    });
    map.on('singleclick', (event) => {
      const original = event.originalEvent as MouseEvent;
      const keys =
        clickKeysRef.current.get(original) ?? Array.from(heldKeysRef.current);
      const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
      const [longitude, latitude] = toLonLat(event.coordinate);
      const modifiers = [
        original.ctrlKey ? 'Ctrl' : '',
        original.metaKey ? 'Meta' : '',
        original.shiftKey ? 'Shift' : '',
        original.altKey ? 'Alt' : '',
      ].filter(Boolean);
      setStatus(
        `Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)} | ` +
          `modifiers: ${modifiers.join('+') || 'none'} | ` +
          `held keys: ${keys.slice().sort().join(', ') || 'none'}`
      );
      if (!normalizedKeys.has('t')) return;
      const priority = original.shiftKey;
      targetCountRef.current += 1;
      const feature = new Feature(new Point(event.coordinate));
      feature.setId(
        `${priority ? 'priority-target' : 'target'}-${targetCountRef.current}`
      );
      feature.set('color', priority ? '#ff8c00' : '#ffff00');
      targetSourceRef.current.addFeature(feature);
    });

    return () => {
      viewport.removeEventListener('pointerdown', focusMap);
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('blur', clearKeys);
      map.setTarget(undefined);
    };
  }, []);

  return (
    <main className="reference-example-window">
      <section className="reference-click-controls">
        <p>
          Click the map to inspect coordinates. Hold <strong>T</strong> while
          clicking to add a yellow target. Hold <strong>Shift+T</strong> to add
          an orange priority target. Shift replaces the desktop Ctrl modifier
          because browsers reserve Ctrl+T for New Tab.
        </p>
        <button
          type="button"
          onClick={() => {
            targetSourceRef.current.clear();
            targetCountRef.current = 0;
            setStatus('Targets cleared.');
          }}
        >
          Clear targets
        </button>
      </section>
      <div className="reference-click-status">{status}</div>
      <div className="reference-map-fill" ref={mapTargetRef} />
    </main>
  );
}
