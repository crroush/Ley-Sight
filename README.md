# LeySight

An unpublished, local-first geospatial analysis application and browser
example suite built around a high-throughput OpenLayers renderer.

This checkpoint proves the high-risk path before a public repository is
created:

- projection, packing, histogramming, and spatial indexing stay in a worker;
- one transferable typed-array dataset crosses to the map after indexing;
- a compact Morton-ordered index preserves the original depth-18,
  32-point-leaf quadtree behavior;
- dense nodes collapse to viewport-scale representatives;
- Web Mercator coordinates remain Float64 and match OpenLayers projection;
- image-canvas dimensions follow the OpenLayers device-pixel contract exactly;
- points and uncertainty ellipses are batched into canvas paths;
- filtering uses a visibility mask plus one bottom-up tree rebuild;
- the GUI includes CSV column mapping, map controls, time histogram, virtual
  table, linked selection, CSV-field coloring, dataset tabs, draggable pane
  separators, and CSV export;
- the table exposes every source column and performs global sorts in a
  dedicated worker;
- the map includes geodesic measurement and a managed base/WMS/XYZ layer
  dialog;
- the timeline and table can be hidden independently, with a true map-only
  workspace when both are hidden.
- the default landing page launches independent CSV, vector, raster, filtering,
  linked-table, and map-event applications;
- all numbered reference use cases have source-level contracts and dedicated
  launcher links for the current parity pass.

All application data stays in the current browser session. Network requests
are limited to the tile/WMS sources configured by the user or runtime config.

## Run locally

Requirements: Node.js 18+ and npm 9+.

```bash
npm install
npm run dev
```

Open the URL printed by Vite. `/` is the example launcher and reference index;
`/csv.html` opens the CSV data lab. The CSV app starts empty—no synthetic or
CSV data is loaded until requested. `/examples.html` remains an alias for the
landing page.

Production build:

```bash
npm run build
npm run preview
```

## Persistent recovery

LeySight streams each selected raw CSV into the browser's Origin Private File
System (OPFS) without first creating a whole-file `ArrayBuffer` or text copy.
A small versioned manifest records dataset grouping, column mapping, color
settings, and histogram view state. If Chrome or another browser discards and
reloads the tab, LeySight reconstructs `File` objects from OPFS and rebuilds the
packed datasets through the normal worker pipeline.

The header reports `OPFS RECOVERY`, `SAVING TO OPFS`, or `RESTORING OPFS`.
**File → Clear Saved Workspace** removes the saved raw files and unloads the
current datasets. Browsers without OPFS remain usable but report `SESSION ONLY`.

## Test

```bash
npm test
RUN_MILLION_BENCHMARK=1 npm test
RUN_SEVEN_MILLION_BENCHMARK=1 npm test
RUN_SEVEN_MILLION_SELECTION_BENCHMARK=1 npm test
```

The normal suite tests typed-array growth, both spatial index implementations,
direct candidate-selection parity between the original object quadtree and the
compact index, the OpenLayers image-canvas device-pixel contract, and Web
Mercator projection against OpenLayers at known locations. The opt-in
benchmarks exercise the original one-million-point object quadtree and the
replacement seven-million-point compact index without needing a browser. These
are index benchmarks, not claims about CSV parsing or end-to-end performance
on every browser and machine.


## Reusable example recipes

The legacy `src/demos/` entry files now stay as route-compatible re-exports, while reusable examples live under `src/examples/recipes/` and compose app-agnostic widgets from `src/widgets/`. Demo-only generators and reference seed data live in `src/examples/data/` so recipes can share fixtures without copying application infrastructure.

| Recipe | Entry re-export | Widgets demonstrated | Minimum app scaffold |
| --- | --- | --- | --- |
| Filtering recipe | `FilteringDemoApp` | `VirtualDataTable`, split-pane/table/map composition, timeline-style range controls | Build rows with `src/examples/data/sampleData.ts`, pack them into `FastPointEngine`, then render a `VirtualDataTable` beside the map and pass table selection to `engine.selectIndices`. |
| Table integration recipe | `TableIntegrationExampleApp` | `VirtualDataTable`, map/table linked selection, row context actions, layer-style controls | Keep a typed row array, derive map datasets from mapped rows, and use `VirtualDataTable` with stable row keys to synchronize table clicks and map selections. |
| Linked table recipes | `DualTableLinkingExampleApp`, `MetadataOnlyLinkingExampleApp` | `VirtualDataTable`, reusable split pane separators, selection summaries between related tables | Model parent/child row ids, render each relation with `VirtualDataTable`, and translate selections through shared ids rather than rebuilding table infrastructure. |

To start a new example app, import the reusable widgets from `src/widgets`, import any synthetic fixtures from `src/examples/data`, and add only the domain-specific state transitions in a new `src/examples/recipes/*RecipeApp.tsx` module. Keep the corresponding `src/demos/*` file as a one-line export when an existing route depends on the old name.
