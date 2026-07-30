import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {parseWorkspaceManifest} from "./opfsWorkspace";

const VALID_WORKSPACE = {
  version: 1,
  activeStorageId: "tab-a",
  tabs: [{
    storageId: "tab-a",
    schemaKey: "latitude\u001flongitude",
    title: "positions",
    columns: ["latitude", "longitude"],
    files: [{
      id: "file-a",
      name: "positions.csv",
      type: "text/csv",
      size: 2048,
      lastModified: 1234,
    }],
    mapping: {latitude: "latitude", longitude: "longitude"},
    colorField: "__uniform__",
    colorPalette: "turbo",
    colorValueMode: "categorical",
  }],
};

describe("OPFS workspace manifest", () => {
  it("accepts a versioned CSV recovery manifest", () => {
    assert.deepEqual(parseWorkspaceManifest(VALID_WORKSPACE), VALID_WORKSPACE);
  });

  it("rejects unsupported versions and incomplete file identities", () => {
    assert.throws(
      () => parseWorkspaceManifest({...VALID_WORKSPACE, version: 2}),
      /unsupported format/,
    );
    assert.throws(
      () =>
        parseWorkspaceManifest({
          ...VALID_WORKSPACE,
          tabs: [{
            ...VALID_WORKSPACE.tabs[0],
            files: [{name: "positions.csv"}],
          }],
        }),
      /unsupported format/,
    );
  });
});
