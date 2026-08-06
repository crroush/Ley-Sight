import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

function source(name: string): string {
  return readFileSync(new URL(name, ROOT), 'utf8');
}

test('standalone route defaults are declared in the route registry', () => {
  const registry = source('routes/routeRegistry.ts');
  assert.match(
    registry,
    /id: 'raster'[\s\S]*?component: RasterOverlayExampleApp/
  );
  assert.match(registry, /id: 'vector'[\s\S]*?component: BasicMapExampleApp/);
  assert.match(
    registry,
    /id: 'linked-tables'[\s\S]*?component: DualTableLinkingExampleApp/
  );
  assert.match(
    registry,
    /id: 'map-events'[\s\S]*?component: MapRightClickExampleApp/
  );
});

test('every standalone OpenLayers entry imports the OpenLayers controls CSS', () => {
  for (const entry of [
    'apps/filtering/index.tsx',
    'apps/linked-tables/index.tsx',
    'apps/map-events/index.tsx',
    'apps/raster/index.tsx',
    'apps/vector/index.tsx',
  ]) {
    assert.match(source(entry), /import ['"]ol\/ol\.css['"]/, entry);
  }
});

test('CSV workspace keeps examples on the landing page and uses reference menus', () => {
  const app = source('apps/csv/CsvWorkspaceApp.tsx');
  assert.doesNotMatch(app, /All examples/);
  assert.match(app, /<summary>File<\/summary>/);
  assert.match(app, /<summary>Map<\/summary>/);
  assert.match(app, /<summary>Selection<\/summary>/);
  assert.match(app, /Show Only Selected/);
  assert.match(app, /Hide Selected/);
  assert.match(app, /Show All/);
});

test('CSV recovery persists both timeline ranges and cancels stale checks', () => {
  const app = source('apps/csv/CsvWorkspaceApp.tsx');
  const state = source('apps/csv/csvWorkspaceState.ts');
  const storage = source('storage/opfsWorkspace.ts');
  assert.match(state, /timeFilterRange: tab\.timeFilterRange/);
  assert.match(app, /const restoredRange = tab\.timeFilterRange/);
  assert.match(app, /let cancelled = false/);
  assert.match(app, /if \(cancelled\) return/);
  assert.match(storage, /timeFilterRange\?: \[number, number\]/);
  assert.match(storage, /timeViewRange\?: \[number, number\]/);
});

test('CSV recovery asks before loading a saved workspace', () => {
  const app = source('apps/csv/CsvWorkspaceApp.tsx');
  const storage = source('storage/opfsWorkspace.ts');
  assert.match(app, /Restore saved workspace\?/);
  assert.match(app, /Start fresh/);
  assert.match(app, /setSavedWorkspaces\(workspaces\)/);
  assert.match(app, /savedWorkspaces\.map/);
  assert.match(storage, /SESSION_MANIFEST_PREFIX/);
  assert.match(storage, /loadWorkspaceManifests/);
  assert.doesNotMatch(storage, /MANIFEST_FILE|sessionId\?: string/);
  assert.doesNotMatch(app, /Math\.random/);
  assert.doesNotMatch(
    app,
    /setPersistenceState\("restoring"\);\s*recoveredActiveStorageIdRef\.current = workspace/
  );
});

test('CSV map reserves modifier drag for selection instead of box zoom', () => {
  const engine = source('map/FastPointEngine.ts');
  assert.match(
    engine,
    /defaultInteractions\(\{\s*shiftDragZoom: false,?\s*\}\)/
  );
  assert.match(
    engine,
    /new DragBox\(\{\s*condition: modifierBoxSelection,?\s*\}\)/
  );
});
