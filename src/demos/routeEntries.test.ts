import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

function source(name: string): string {
  return readFileSync(new URL(name, ROOT), "utf8");
}

test("standalone route defaults never fall back to grouped showcase demos", () => {
  const raster = source("rasterMain.tsx");
  const vector = source("vectorMain.tsx");
  const linked = source("linkedTablesMain.tsx");
  const events = source("mapEventsMain.tsx");

  assert.match(raster, /<RasterOverlayExampleApp \/>/);
  assert.doesNotMatch(raster, /RasterDemoApp/);
  assert.match(vector, /return <BasicMapExampleApp \/>/);
  assert.doesNotMatch(vector, /VectorDemoApp/);
  assert.match(linked, /return <DualTableLinkingExampleApp \/>/);
  assert.doesNotMatch(linked, /LinkedTablesDemoApp/);
  assert.match(events, /<MapRightClickExampleApp \/>/);
  assert.doesNotMatch(events, /MapEventsDemoApp/);
});

test("every standalone OpenLayers entry imports the OpenLayers controls CSS", () => {
  for (const entry of [
    "filteringMain.tsx",
    "linkedTablesMain.tsx",
    "main.tsx",
    "mapEventsMain.tsx",
    "rasterMain.tsx",
    "vectorMain.tsx",
  ]) {
    assert.match(source(entry), /import "ol\/ol\.css";/, entry);
  }
});

test("CSV workspace keeps examples on the landing page and uses reference menus", () => {
  const app = source("App.tsx");
  assert.doesNotMatch(app, /All examples/);
  assert.match(app, /<summary>File<\/summary>/);
  assert.match(app, /<summary>Map<\/summary>/);
  assert.match(app, /<summary>Selection<\/summary>/);
  assert.match(app, /Show Only Selected/);
  assert.match(app, /Hide Selected/);
  assert.match(app, /Show All/);
});

test("CSV recovery persists both timeline ranges and cancels stale checks", () => {
  const app = source("App.tsx");
  const storage = source("storage/opfsWorkspace.ts");
  assert.match(app, /timeFilterRange: tab\.timeFilterRange/);
  assert.match(app, /const restoredRange = tab\.timeFilterRange/);
  assert.match(app, /let cancelled = false/);
  assert.match(app, /if \(cancelled\) return/);
  assert.match(storage, /timeFilterRange\?: \[number, number\]/);
  assert.match(storage, /timeViewRange\?: \[number, number\]/);
});

test("CSV recovery asks before loading a saved workspace", () => {
  const app = source("App.tsx");
  const storage = source("storage/opfsWorkspace.ts");
  assert.match(app, /Restore saved workspace\?/);
  assert.match(app, /Start fresh/);
  assert.match(app, /setSavedWorkspaces\(workspaces\)/);
  assert.match(app, /savedWorkspaces\.map/);
  assert.match(storage, /SESSION_MANIFEST_PREFIX/);
  assert.match(storage, /loadWorkspaceManifests/);
  assert.doesNotMatch(app, /setPersistenceState\("restoring"\);\s*recoveredActiveStorageIdRef\.current = workspace/);
});

test("CSV map reserves modifier drag for selection instead of box zoom", () => {
  const engine = source("map/FastPointEngine.ts");
  assert.match(engine, /defaultInteractions\(\{shiftDragZoom: false\}\)/);
  assert.match(engine, /new DragBox\(\{condition: modifierBoxSelection\}\)/);
});
