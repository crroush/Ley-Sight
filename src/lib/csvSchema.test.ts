import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csvSchemaKey, groupItemsByCsvSchema } from "./csvSchema";

describe("CSV schema grouping", () => {
  it("combines matching headers and separates different data types", () => {
    const files = [
      { name: "one.csv", columns: ["lat", "lon", "class"] },
      { name: "two.csv", columns: ["lat", "lon", "class"] },
      { name: "events.csv", columns: ["lat", "lon", "timestamp"] },
    ];
    const groups = groupItemsByCsvSchema(files, (file) => file.columns);
    assert.equal(groups.size, 2);
    assert.deepEqual(
      groups.get(csvSchemaKey(files[0].columns))?.map((file) => file.name),
      ["one.csv", "two.csv"],
    );
    assert.deepEqual(
      groups.get(csvSchemaKey(files[2].columns))?.map((file) => file.name),
      ["events.csv"],
    );
  });

  it("groups the same named fields even when column order differs", () => {
    assert.equal(
      csvSchemaKey(["latitude", "longitude"]),
      csvSchemaKey(["longitude", "latitude"]),
    );
  });
});
