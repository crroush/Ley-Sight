import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync, gzipSync} from "node:zlib";
import {describe, it} from "node:test";
import {decodePackagedResponse} from "./packagedGeoJson";

describe("packaged GeoJSON transport", () => {
  it("accepts a response already decompressed by Fetch", async () => {
    const json = '{"type":"FeatureCollection","features":[]}';
    assert.equal(
      await decodePackagedResponse(new Response(json)),
      json,
    );
  });

  it("accepts a raw gzip response", async () => {
    const json = '{"type":"FeatureCollection","features":[{"id":1}]}';
    const compressed = gzipSync(json);
    const bytes = compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    ) as ArrayBuffer;
    assert.equal(
      await decodePackagedResponse(new Response(bytes)),
      json,
    );
  });

  it("ships the complete Qt country and hydrology feature sets", () => {
    const parse = (name: string): {features: unknown[]} =>
      JSON.parse(
        gunzipSync(
          readFileSync(new URL(`../../public/resources/${name}.geojson.gz`, import.meta.url)),
        ).toString("utf8"),
      ) as {features: unknown[]};
    assert.equal(parse("countries").features.length, 258);
    assert.equal(parse("lakes").features.length, 1_355);
  });
});
