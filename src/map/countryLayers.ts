import GeoJSON from 'ol/format/GeoJSON.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import {Fill, Stroke, Style} from 'ol/style.js';
import {loadPackagedGeoJson} from '../lib/packagedGeoJson';

export type PackagedCountryLayers = {
  countries: VectorLayer<VectorSource>;
  hydrology: VectorLayer<VectorSource>;
  load: () => Promise<void>;
  setStrokeColor: (color: string) => void;
  setVisible: (visible: boolean) => Promise<void>;
};

function countryStyle(color: string): Style {
  return new Style({
    fill: new Fill({color: 'rgba(0, 0, 0, 0)'}),
    stroke: new Stroke({color, width: 1}),
  });
}

function hydrologyStyle(feature: {
  get: (name: string) => unknown;
  getGeometry: () => {getType: () => string} | undefined;
}): Style {
  const featureClass = String(feature.get('featurecla') ?? '').toLowerCase();
  const geometryType = feature.getGeometry()?.getType() ?? '';
  if (featureClass.includes('river')) {
    return new Style({
      stroke: new Stroke({color: '#1d4ed8', width: 1.5}),
    });
  }
  if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
    return new Style({
      fill: new Fill({color: 'rgba(59, 130, 246, 0.35)'}),
      stroke: new Stroke({color: '#2563eb', width: 1}),
    });
  }
  return new Style({
    stroke: new Stroke({color: '#2563eb', width: 2.5}),
  });
}

/**
 * Creates the same two packaged boundary layers as ol_bridge.js.
 *
 * VectorSource keeps wrapX enabled, so OpenLayers repeats the packaged
 * geometries when the view crosses the international date line.
 */
export function createPackagedCountryLayers(
  initialStrokeColor = '#334155'
): PackagedCountryLayers {
  const countrySource = new VectorSource({wrapX: true});
  const hydrologySource = new VectorSource({wrapX: true});
  const countries = new VectorLayer({
    source: countrySource,
    visible: false,
    style: countryStyle(initialStrokeColor),
  });
  const hydrology = new VectorLayer({
    source: hydrologySource,
    visible: false,
    style: hydrologyStyle,
  });
  countries.set('id', '_country_boundaries');
  countries.setZIndex(50);
  hydrology.set('id', '_hydrology');
  hydrology.setZIndex(51);

  let countryLoadPromise: Promise<void> | null = null;
  let hydrologyLoadPromise: Promise<void> | null = null;
  const load = (): Promise<void> => {
    // ol_bridge.js loads these resources independently. Keep that contract so
    // a hydrology failure cannot prevent the country boundaries from drawing.
    if (!countryLoadPromise) {
      countryLoadPromise = loadPackagedGeoJson('countries')
        .then((countryData) => {
          const format = new GeoJSON();
          countrySource.clear(true);
          countrySource.addFeatures(
            format.readFeatures(countryData, {
              featureProjection: 'EPSG:3857',
            })
          );
        })
        .catch((error: unknown) => {
          countryLoadPromise = null;
          throw error;
        });
    }
    if (!hydrologyLoadPromise) {
      hydrologyLoadPromise = loadPackagedGeoJson('lakes')
        .then((lakeData) => {
          const format = new GeoJSON();
          hydrologySource.clear(true);
          hydrologySource.addFeatures(
            format.readFeatures(lakeData, {
              featureProjection: 'EPSG:3857',
            })
          );
        })
        .catch((error: unknown) => {
          hydrologyLoadPromise = null;
          throw error;
        });
    }
    // Country outlines are the primary contract. Hydrology is supplemental,
    // so do not hide successfully loaded boundaries if only that resource
    // fails.
    return countryLoadPromise.then(async () => {
      await Promise.allSettled([hydrologyLoadPromise]);
    });
  };

  return {
    countries,
    hydrology,
    load,
    setStrokeColor: (color) => countries.setStyle(countryStyle(color)),
    setVisible: async (visible) => {
      countries.setVisible(visible);
      hydrology.setVisible(visible);
      if (visible) await load();
    },
  };
}
