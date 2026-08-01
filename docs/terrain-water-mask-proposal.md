# Terrain surface and water-mask proposal

## Finding

The AWS Terrain Tiles endpoint is an elevation source, not a land/water
classification source. Terrarium encodes a signed elevation in RGB; the format
does not reserve `0`, `-1`, or any other decoded height for ocean. The source is
a mosaic assembled by Tilezen's Joerd pipeline, so an ocean pixel can represent
sea level, bathymetry, an interpolated coastal value, or missing source data.
Consequently, neither `elevation === 0` nor `elevation < 0` is a valid water
test. The latter would also destroy valid land elevations in places such as the
Dead Sea basin.

The visibility surface is also not the bathymetric surface. Where a sample is
classified as open water, line of sight should use the water surface (normally
`0 m` relative to the DEM's vertical datum), not a negative sea-floor sample.

Primary sources identified for verification:

- [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
  describes the global terrain-tile collection and its formats.
- [Tilezen Joerd formats](https://github.com/tilezen/joerd/blob/master/docs/formats.md)
  defines Terrarium's RGB-to-signed-elevation decoding.
- [NASA SRTM Water Body Data](https://www.earthdata.nasa.gov/data/catalog/lpcloud-srtm-water-body-data-swbdf-003)
  is a dedicated coastline/water-body classification rather than an elevation
  heuristic, but its SRTM latitude coverage makes it unsuitable as the only
  global mask.
- [Natural Earth 1:10m land polygons](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/)
  provide a public-domain global fallback, but are too generalized to be the
  primary mask for beach-scale analysis.

Network access to these references was unavailable in the development
container, so implementation should verify current licenses, download URLs,
vertical datum, and redistribution terms before vendoring data.

## Interim policy

For now, clamp every finite negative Terrarium elevation to `0 m` at the point
where raw DEM becomes a visible surface. Continue representing missing raw
samples as `NaN`, count them before applying the separate `0 m` missing-data
fallback, and leave non-negative elevations unchanged.

This intentionally trades away valid below-sea-level land elevations. It is a
simple, predictable mitigation for the much larger ocean bathymetry error and
does not pretend that elevation alone is a reliable water classification. It
also does not solve positive coastal merging artifacts; those remain a known
limitation and should be communicated as degraded coastal accuracy.

The raw provider should continue decoding signed Terrarium elevation unchanged.
Keeping normalization at the visible-surface boundary makes the workaround easy
to replace and preserves raw values for diagnostics.

## Later solution

Add an independent, versioned land/water mask. Prefer a global raster or vector
product with coastal resolution comparable to the DEM (for example, the water
classification/editing mask distributed with a current global DEM). Package or
proxy it as immutable Web Mercator tiles so the worker can fetch elevation and
classification at the same grid positions. Use Natural Earth only as a
low-resolution fallback outside the primary mask's coverage.

Represent each sample with two independent dimensions:

```ts
type SurfaceKind = "land" | "water" | "unknown";

type TerrainGrid = {
  elevationM: Float64Array; // NaN means the DEM sample is missing
  surfaceKind: Uint8Array;  // land, water, or unknown
  demAvailability: AvailabilitySummary;
  maskAvailability: AvailabilitySummary;
};
```

Apply policy only after sampling:

| DEM | Mask | Visibility surface | Clutter | Result quality |
| --- | --- | --- | --- | --- |
| finite | land | preserve signed DEM | apply | normal |
| finite | water | `0 m` water surface | none | normal |
| finite | unknown | preserve signed DEM | apply conservatively | degraded |
| missing | water | `0 m` water surface | none | degraded |
| missing | land/unknown | explicit configured fallback | apply conservatively | degraded |

This keeps legitimate negative land, stops unreliable ocean bathymetry from
becoming the visible surface, and avoids guessing that zero-elevation coastal
land is water. The response metadata should report DEM and mask coverage
separately so users know why a result is degraded.

## Delivery plan

1. Select and license-review a global mask; record product version, resolution,
   datum, checksum, and attribution.
2. Add a `SurfaceMaskProvider` with the same tile cache and bulk-grid interface
   as `TerrariumTerrainProvider`.
3. Return the structured `TerrainGrid` above and centralize the policy in one
   pure `resolveVisibleSurface` function shared by the worker and inspector.
4. Propagate a water/land/unknown grid through analysis-grid resampling. Use
   nearest-neighbor classification for the categorical mask; never bilinear
   interpolation.
5. Extend worker metadata and the warning banner with separate DEM/mask missing
   counts and the selected fallback policy.
6. Add fixtures for a beach crossing, a small island, a zero-elevation coastal
   plain, negative dry land, inland water, partial mask failure, partial DEM
   failure, and complete failure. Assert map and inspector classifications are
   identical for every fixture.

Until this mask exists, apply the interim negative-to-zero rule consistently in
the map worker, ground-observer lookup, and profile inspector. Elevation alone
must still not decide whether clutter applies; the future mask should own that
decision.
