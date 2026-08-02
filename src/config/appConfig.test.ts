import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {DEFAULT_APP_CONFIG, validateConfig} from "./appConfig";

describe("application configuration", () => {
  it("accepts a partial configuration and preserves unspecified defaults", () => {
    const latitude = [{pattern: "^north$", score: 42}];
    const config = validateConfig({csvColumnDetection: {latitude}});

    assert.deepEqual(config.csvColumnDetection.latitude, latitude);
    assert.deepEqual(config.csvColumnDetection.longitude, DEFAULT_APP_CONFIG.csvColumnDetection.longitude);
    assert.deepEqual(config.baseLayers, DEFAULT_APP_CONFIG.baseLayers);
    assert.deepEqual(config.wmsPresets, DEFAULT_APP_CONFIG.wmsPresets);
  });

  it("uses supplied base-layer and preset lists as replacements", () => {
    const config = validateConfig({
      baseLayers: [{id: "local", name: "Local", type: "osm"}],
      wmsPresets: [{id: "weather", name: "Weather", type: "wms", url: "https://example.test/wms", layers: "radar", opacity: 0.5, visible: false}],
    });

    assert.deepEqual(config.baseLayers.map(({id}) => id), ["local"]);
    assert.deepEqual(config.wmsPresets.map(({id}) => id), ["weather"]);
  });

  it("rejects explicit null layer lists instead of treating them as omitted", () => {
    assert.throws(
      () => validateConfig({baseLayers: null}),
      /baseLayers: must contain at least one layer/,
    );
    assert.throws(
      () => validateConfig({wmsPresets: null}),
      /wmsPresets: must be an array/,
    );
  });

  it("reports the path of invalid nested definitions", () => {
    assert.throws(
      () => validateConfig({baseLayers: [{id: "tiles", name: "Tiles", type: "xyz"}]}),
      /baseLayers\[0\]\.url/,
    );
    assert.throws(
      () => validateConfig({wmsPresets: [{id: "map", name: "Map", type: "wms", url: "https://example.test/wms", opacity: 1, visible: true}]}),
      /wmsPresets\[0\]\.layers/,
    );
    assert.throws(
      () => validateConfig({baseLayers: [{id: "map", name: "Map", type: "other"}]}),
      /baseLayers\[0\]\.type/,
    );
    assert.throws(
      () => validateConfig({csvColumnDetection: {latitude: [{pattern: "x", score: 1, extra: true}]}}),
      /csvColumnDetection\.latitude\[0\]\.extra/,
    );
  });

  it("rejects duplicate layer IDs", () => {
    assert.throws(
      () => validateConfig({baseLayers: [
        {id: "same", name: "First", type: "osm"},
        {id: "same", name: "Second", type: "osm"},
      ]}),
      /baseLayers\[1\]\.id: duplicate id/,
    );
  });

  it("rejects bad regular-expression flags with their path", () => {
    assert.throws(
      () => validateConfig({csvColumnDetection: {latitude: [{pattern: "lat", flags: "ii", score: 1}]}}),
      /csvColumnDetection\.latitude\[0\]\.flags: invalid regular expression/,
    );
  });

  it("rejects non-finite and out-of-range opacity", () => {
    const preset = (opacity: number) => ({id: "tiles", name: "Tiles", type: "xyz", url: "https://example.test/{z}/{x}/{y}.png", opacity, visible: true});
    for (const opacity of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => validateConfig({wmsPresets: [preset(opacity)]}),
        /wmsPresets\[0\]\.opacity/,
      );
    }
  });
});
