import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferCsvColumnMapping } from "./csvColumnInference";

describe("CSV column inference", () => {
  it("recognizes coordinate aliases and an embedded time token", () => {
    const mapping = inferCsvColumnMapping([
      "record_code",
      "ObservationDateTime",
      "LAT",
      "LON",
      "display_label",
    ]);
    assert.equal(mapping.latitude, "LAT");
    assert.equal(mapping.longitude, "LON");
    assert.equal(mapping.time, "ObservationDateTime");
    assert.equal(mapping.color, "record_code");
  });

  it("finds date or time words inside descriptive headers", () => {
    assert.equal(
      inferCsvColumnMapping(["latitude", "longitude", "event_date_utc"]).time,
      "event_date_utc",
    );
    assert.equal(
      inferCsvColumnMapping(["latitude", "longitude", "positionTimeUtc"]).time,
      "positionTimeUtc",
    );
  });

  it("prefers an exact timestamp column over a weaker partial match", () => {
    const mapping = inferCsvColumnMapping([
      "latitude",
      "longitude",
      "position_time_utc",
      "timestamp",
    ]);
    assert.equal(mapping.time, "timestamp");
  });

  it("leaves time unmapped when no date or time name is present", () => {
    const mapping = inferCsvColumnMapping([
      "latitude",
      "longitude",
      "speed",
    ]);
    assert.equal(mapping.time, undefined);
  });
});
