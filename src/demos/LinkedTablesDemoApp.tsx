import {useEffect, useMemo, useRef, useState} from "react";
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import Polygon from "ol/geom/Polygon.js";
import DragBox from "ol/interaction/DragBox.js";
import VectorLayer from "ol/layer/Vector.js";
import TileLayer from "ol/layer/Tile.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import {platformModifierKeyOnly} from "ol/events/condition.js";
import {fromLonLat} from "ol/proj.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";
import {
  Circle as CircleStyle,
  Fill,
  Stroke,
  Style,
} from "ol/style.js";
import {Database, Link2, MapPin} from "lucide-react";
import {DemoHeader} from "./DemoHeader";

type Region = {
  id: string;
  name: string;
  center: [number, number];
};

type Site = {
  id: string;
  name: string;
  regionId: string;
  longitude: number;
  latitude: number;
  score: number;
};

type MetadataRow = {
  id: string;
  regionId: string;
  field: string;
  value: string;
};

const REGIONS: Region[] = [
  {id: "west", name: "Western Range", center: [-120, 40]},
  {id: "mountain", name: "Mountain Range", center: [-108, 39]},
  {id: "central", name: "Central Range", center: [-96, 38]},
  {id: "south", name: "Southern Range", center: [-86, 33]},
  {id: "east", name: "Eastern Range", center: [-75, 40]},
];

function buildSites(): Site[] {
  const sites: Site[] = [];
  for (const [regionIndex, region] of REGIONS.entries()) {
    for (let index = 0; index < 32; index += 1) {
      const angle = (index / 32) * Math.PI * 2;
      const radius = 0.45 + ((index * 17) % 13) / 7;
      sites.push({
        id: `${region.id}-${String(index + 1).padStart(2, "0")}`,
        name: `${region.name} Site ${index + 1}`,
        regionId: region.id,
        longitude: region.center[0] + Math.cos(angle) * radius,
        latitude: region.center[1] + Math.sin(angle) * radius * 0.65,
        score: (regionIndex * 23 + index * 11) % 100,
      });
    }
  }
  return sites;
}

function buildMetadata(): MetadataRow[] {
  const fields = ["owner", "status", "review", "source", "classification"];
  return REGIONS.flatMap((region, regionIndex) =>
    fields.map((field, index) => ({
      id: `${region.id}-meta-${index}`,
      regionId: region.id,
      field,
      value: `${field}-${(regionIndex + 2) * (index + 3)}`,
    })),
  );
}

function regionPolygon(region: Region): Polygon {
  const [longitude, latitude] = region.center;
  return new Polygon([[
    fromLonLat([longitude - 3.8, latitude - 2.3]),
    fromLonLat([longitude + 3.8, latitude - 2.3]),
    fromLonLat([longitude + 3.8, latitude + 2.3]),
    fromLonLat([longitude - 3.8, latitude + 2.3]),
    fromLonLat([longitude - 3.8, latitude - 2.3]),
  ]]);
}

export function LinkedTablesDemoApp() {
  const mapRef = useRef<HTMLDivElement>(null);
  const regionLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const siteLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const selectedRegionsRef = useRef(new Set<string>());
  const selectedSitesRef = useRef(new Set<string>());
  const sites = useMemo(buildSites, []);
  const metadata = useMemo(buildMetadata, []);
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(
    new Set(["west"]),
  );
  const [selectedSites, setSelectedSites] = useState<Set<string>>(new Set());
  const [childMode, setChildMode] = useState<"sites" | "metadata">("sites");
  selectedRegionsRef.current = selectedRegions;
  selectedSitesRef.current = selectedSites;

  useEffect(() => {
    if (!mapRef.current) return;
    const regionSource = new VectorSource({
      features: REGIONS.map((region) => {
        const feature = new Feature(regionPolygon(region));
        feature.setProperties({kind: "region", ...region});
        return feature;
      }),
    });
    const siteSource = new VectorSource({
      features: sites.map((site) => {
        const feature = new Feature(
          new Point(fromLonLat([site.longitude, site.latitude])),
        );
        feature.setProperties({kind: "site", ...site});
        return feature;
      }),
    });
    const regionLayer = new VectorLayer({
      source: regionSource,
      style: (feature) => {
        // OpenLayers style callbacks read refs so selection does not require
        // rebuilding feature objects or map layers.
        const selected = selectedRegionsRef.current.has(
          String(feature.get("id")),
        );
        return new Style({
          fill: new Fill({
            color: selected
              ? "rgba(14, 165, 233, 0.25)"
              : "rgba(30, 64, 86, 0.16)",
          }),
          stroke: new Stroke({
            color: selected ? "#38bdf8" : "#5d7185",
            width: selected ? 3 : 1.5,
          }),
        });
      },
    });
    const siteLayer = new VectorLayer({
      source: siteSource,
      style: (feature) => {
        const id = String(feature.get("id"));
        const regionId = String(feature.get("regionId"));
        const directlySelected = selectedSitesRef.current.has(id);
        const linked = selectedRegionsRef.current.has(regionId);
        return new Style({
          image: new CircleStyle({
            radius: directlySelected ? 8 : linked ? 6 : 4,
            fill: new Fill({
              color: directlySelected
                ? "#f97316"
                : linked ? "#38bdf8" : "#64748b",
            }),
            stroke: new Stroke({
              color: directlySelected || linked ? "#ffffff" : "#9ca3af",
              width: directlySelected ? 3 : 1,
            }),
          }),
        });
      },
    });
    regionLayerRef.current = regionLayer;
    siteLayerRef.current = siteLayer;
    regionLayer.setZIndex(2);
    siteLayer.setZIndex(4);

    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({source: new OSM()}),
        regionLayer,
        siteLayer,
      ],
      view: new View({center: fromLonLat([-98, 38]), zoom: 4}),
    });
    map.on("singleclick", (event) => {
      const feature = map.forEachFeatureAtPixel(
        event.pixel,
        (candidate) => candidate,
      );
      if (!feature) {
        setSelectedSites(new Set());
        return;
      }
      if (feature.get("kind") === "site") {
        setSelectedSites(new Set([String(feature.get("id"))]));
      } else {
        setSelectedRegions(new Set([String(feature.get("id"))]));
      }
    });
    const dragBox = new DragBox({condition: platformModifierKeyOnly});
    map.addInteraction(dragBox);
    dragBox.on("boxend", () => {
      const extent = dragBox.getGeometry().getExtent();
      setSelectedSites(
        new Set(
          siteSource
            .getFeaturesInExtent(extent)
            .map((feature) => String(feature.get("id"))),
        ),
      );
    });

    return () => map.setTarget(undefined);
  }, [sites]);

  useEffect(() => {
    regionLayerRef.current?.changed();
    siteLayerRef.current?.changed();
  }, [selectedRegions, selectedSites]);

  const linkedSiteIds = useMemo(
    () =>
      new Set(
        sites
          .filter((site) => selectedRegions.has(site.regionId))
          .map((site) => site.id),
      ),
    [selectedRegions, sites],
  );

  const toggleRegion = (
    regionId: string,
    additive: boolean,
  ): void => {
    setSelectedRegions((current) => {
      const next = additive ? new Set(current) : new Set<string>();
      if (next.has(regionId)) next.delete(regionId);
      else next.add(regionId);
      return next;
    });
  };

  return (
    <div className="demo-app">
      <DemoHeader
        title="Linked map and tables"
        description="Parent selection fans out to spatial children or metadata-only rows without creating child map objects."
        useCases={[13, 16]}
      />
      <div className="demo-toolbar">
        <button
          className={`tool-button ${childMode === "sites" ? "is-active" : ""}`}
          onClick={() => setChildMode("sites")}
        >
          <MapPin size={15} /> Spatial sites
        </button>
        <button
          className={`tool-button ${childMode === "metadata" ? "is-active" : ""}`}
          onClick={() => setChildMode("metadata")}
        >
          <Database size={15} /> Metadata only
        </button>
        <span className="linked-summary">
          {selectedRegions.size} parents · {linkedSiteIds.size} linked sites · {selectedSites.size} direct map selections
        </span>
      </div>
      <main className="linked-demo-content">
        <div className="demo-map">
          <div className="demo-map-target" ref={mapRef} />
          <div className="demo-overlay-note">
            Click regions or sites · Ctrl/Cmd-drag selects a site subset
          </div>
        </div>
        <section className="linked-tables">
          <div className="linked-table">
            <header>
              <Link2 size={14} />
              <strong>Table 1: regions</strong>
              <span>Ctrl/Cmd-click for multiple</span>
            </header>
            <div>
              {REGIONS.map((region) => (
                <button
                  className={selectedRegions.has(region.id) ? "is-selected" : ""}
                  key={region.id}
                  onClick={(event) =>
                    toggleRegion(
                      region.id,
                      event.ctrlKey || event.metaKey,
                    )
                  }
                >
                  <span>{region.name}</span>
                  <small>{sites.filter((site) => site.regionId === region.id).length} sites</small>
                </button>
              ))}
            </div>
          </div>
          <div className="linked-table child-table">
            <header>
              {childMode === "sites" ? <MapPin size={14} /> : <Database size={14} />}
              <strong>
                Table 2: {childMode === "sites" ? "sites" : "metadata rows"}
              </strong>
              <span>Linked highlighting</span>
            </header>
            <div>
              {childMode === "sites"
                ? sites.map((site) => (
                    <button
                      className={
                        selectedSites.has(site.id)
                          ? "is-direct"
                          : linkedSiteIds.has(site.id) ? "is-linked" : ""
                      }
                      key={site.id}
                      onClick={() => setSelectedSites(new Set([site.id]))}
                    >
                      <span>{site.name}</span>
                      <small>{site.regionId} · score {site.score}</small>
                    </button>
                  ))
                : metadata.map((row) => (
                    <button
                      className={
                        selectedRegions.has(row.regionId) ? "is-linked" : ""
                      }
                      key={row.id}
                    >
                      <span>{row.field}: {row.value}</span>
                      <small>{row.regionId} · no geometry</small>
                    </button>
                  ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
