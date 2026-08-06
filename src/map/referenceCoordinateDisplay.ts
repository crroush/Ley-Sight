import type Map from 'ol/Map.js';
import type {EventsKey} from 'ol/events.js';
import {unByKey} from 'ol/Observable.js';
import {toLonLat} from 'ol/proj.js';

export type ReferenceCoordinateDisplay = {
  setVisible: (visible: boolean) => void;
  dispose: () => void;
};

/**
 * Installs the coordinate readout that OLMapWidget enables by default.
 *
 * The text, six-decimal formatting, 50 ms throttle, placement, and initially
 * hidden state mirror ol_bridge.js. The element is attached to the map target
 * so it remains anchored to the lower-right corner through map resizes.
 */
export function installReferenceCoordinateDisplay(
  map: Map,
  target: HTMLElement,
  initiallyVisible = true
): ReferenceCoordinateDisplay {
  const output = document.createElement('output');
  output.className = 'reference-default-coordinate-display';
  output.style.display = 'none';
  target.appendChild(output);

  let pointerKey: EventsKey | null = null;
  let lastUpdate = 0;

  const setVisible = (visible: boolean): void => {
    if (visible && !pointerKey) {
      pointerKey = map.on('pointermove', (event) => {
        const now = performance.now();
        if (now - lastUpdate < 50) return;
        lastUpdate = now;
        const [longitude, latitude] = toLonLat(event.coordinate);
        output.textContent = `Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}`;
        output.style.display = 'block';
      });
      return;
    }
    if (!visible && pointerKey) {
      unByKey(pointerKey);
      pointerKey = null;
      output.style.display = 'none';
    }
  };

  setVisible(initiallyVisible);
  return {
    setVisible,
    dispose: () => {
      if (pointerKey) unByKey(pointerKey);
      pointerKey = null;
      output.remove();
    },
  };
}
