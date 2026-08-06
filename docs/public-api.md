# Public API

Ley Sight's supported application-facing imports live under `src/toolkit`. Use
`src/toolkit/index.ts` for the primary namespace-based API, or a grouped module
(`widgets`, `map`, `data`, `workers`, or `persistence`) when a narrower import
is preferable. The recipe applications use these paths so accidental API drift
is caught by the normal TypeScript build.

## Stable

- **Widgets:** `MapPanel`, `VirtualDataTable`, `HistogramRange`, and the other
  controls exported by `toolkit/widgets`.
- **Map and data:** `FastPointEngine`, the compact-index and projection helpers,
  shared packed-dataset types, palettes, timestamp helpers, and histogram
  helpers explicitly exported by `toolkit/map` and `toolkit/data`.
- **Persistence:** the OPFS workspace operations and persisted-workspace types
  exported by `toolkit/persistence`.

“Stable” means these identifiers are intended for reuse and changes should
preserve compatibility or be called out in release notes. Stability does not
extend to an identifier merely because its implementation file exports it.

## Experimental

`toolkit/workers` is experimental. Its algorithms are useful outside the
built-in workers, but signatures may evolve as the worker protocols mature.

## Internal

Everything outside `src/toolkit` that is not re-exported there is an
implementation detail. In particular, worker entry points (`*.worker.ts`),
rendering indexes and buffers, selection internals, demo data, and component
implementation modules should not be imported directly by applications.
Internal exports exist for tests and collaboration between Ley Sight modules;
they do not imply compatibility guarantees.
