import "ol/ol.css";
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, useCallback } from "react";
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import LineString from "ol/geom/LineString.js";
import VectorLayer from "ol/layer/Vector.js";
import TileLayer from "ol/layer/Tile.js";
import ImageLayer from "ol/layer/Image.js";
import ImageStatic from "ol/source/ImageStatic.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import { fromLonLat, toLonLat } from "ol/proj.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style.js";

import { TerrariumTerrainProvider } from "./workers/terrain";
import {
  groundCollectorElevationM,
  modeledProfileElevationM,
  validateViewshedHeightParameters,
} from "./workers/viewshedParameters";

const WGS84_A_M = 6378137.0;
function lonToMercatorX(lon: number) {
  return (lon * WGS84_A_M * Math.PI) / 180.0;
}
function latToMercatorY(lat: number) {
  return (
    WGS84_A_M *
    Math.log(Math.tan(Math.PI / 4.0 + (lat * Math.PI) / 180.0 / 2.0))
  );
}

type Observer = {
  name: string;
  kind: "geo" | "leo" | "aircraft" | "ground";
  latitude_deg: number;
  longitude_deg: number;
  altitude_m: number;
  antennaHeightAglM: number;
  color: string;
};

type ProfileResult = {
  idx: number;
  loading: boolean;
  obsName: string;
  obsAlt: number;
  tgtAlt: number;
  distM: number;
  profileLengthM: number;
  profile: { x: number; y: number; rayAlt: number }[];
  minElev: number;
  maxElev: number;
  isBlocked: boolean;
};

export function toLatLon(
  coordinate: number[],
  projection?: string
): [number, number] {
  const [lon, lat] = toLonLat(coordinate, projection);
  return [lat, lon];
}

function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatElev(m: number): string {
  if (Math.abs(m) >= 10000) return (m / 1000).toFixed(1) + " km";
  return m.toFixed(0) + " m";
}

const HtmlPin = ({ color }: { color: string }) => (
  <svg
    width="24"
    height="32"
    viewBox="0 0 24 32"
    style={{ filter: "drop-shadow(0px 3px 3px rgba(0,0,0,0.3))" }}
  >
    <path
      d="M 12 32 C 12 32 3 21.5 3 12 C 3 7.029 7.029 3 12 3 C 16.971 3 21 7.029 21 12 C 21 21.5 12 32 12 32 Z"
      fill={color}
      stroke="#ffffff"
      strokeWidth="2"
    />
    <circle cx="12" cy="12" r="4" fill="#ffffff" />
  </svg>
);

export function ViewshedApp() {
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const terrainProviderRef = useRef<TerrariumTerrainProvider | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  const lastExtentStrRef = useRef<string>("");
  const isComputingRef = useRef<boolean>(false);
  const runIdRef = useRef<number>(0);

  // Application State
  const [viewQuestion, setViewQuestion] = useState<string>("coverage-all");
  const [singleDetail, setSingleDetail] = useState<string>("blocked");
  const [targetHeightAgl, setTargetHeightAgl] = useState<number>(0.0);
  const [targetHeightDraft, setTargetHeightDraft] = useState<string>("0");
  const [targetHeightInputState, setTargetHeightInputState] = useState<
    "clean" | "dirty" | "invalid"
  >("clean");
  const [antennaHeightDrafts, setAntennaHeightDrafts] = useState<
    Record<number, string>
  >({});
  const [obstructionHeightM, setObstructionHeightM] = useState<number>(0.0);

  const [losOpacity, setLosOpacity] = useState<number>(65);
  const [baseMapOpacity, setBaseMapOpacity] = useState<number>(100);
  const [isComputing, setIsComputing] = useState<boolean>(false);
  const [advancedExpanded, setAdvancedExpanded] = useState<boolean>(false);
  const [observersDropdownOpen, setObserversDropdownOpen] =
    useState<boolean>(false);

  const [inspectorText, setInspectorText] = useState<string>(
    "Hold 'I' + Click to see LOS."
  );

  const [observers, setObservers] = useState<Observer[]>([
    {
      name: "Ground Site",
      kind: "ground",
      latitude_deg: 39.730722,
      longitude_deg: -105.232111,
      altitude_m: 223.0,
      antennaHeightAglM: 10.0,
      color: "#e34a33",
    },
    {
      name: "Airborne",
      kind: "aircraft",
      latitude_deg: 39.25,
      longitude_deg: -105.7,
      altitude_m: 9144.0,
      antennaHeightAglM: 0.0,
      color: "#16a34a",
    },
  ]);

  const [activeCollectors, setActiveCollectors] = useState<Set<number>>(
    new Set([0])
  );
  const [mapQuestion, setMapQuestion] = useState("coverage-all");
  const [activeCollectorIdx, setActiveCollectorIdx] = useState<number>(0);

  // Editor & Profile State
  const [showEditor, setShowEditor] = useState<boolean>(false);
  const [mapPickWaitingIdx, setMapPickWaitingIdx] = useState<number | null>(
    null
  );

  const [profileData, setProfileData] = useState<{
    active: boolean;
    results: ProfileResult[];
  } | null>(null);
  const [activeProfileTab, setActiveProfileTab] = useState<number>(0);

  // Map Layers
  const osmSourceRef = useRef(new OSM());
  const osmLayerRef = useRef(new TileLayer({ source: osmSourceRef.current }));
  const collectorLayerRef = useRef(
    new VectorLayer({ source: new VectorSource(), zIndex: 10 })
  );
  const validationLayerRef = useRef(
    new VectorLayer({ source: new VectorSource(), zIndex: 11 })
  );
  const visibilityLayerRef = useRef(
    new ImageLayer({ opacity: losOpacity / 100, zIndex: 5 })
  );

  // Synchronous Mutable Refs
  const observersRef = useRef(observers);
  observersRef.current = observers;
  const targetHeightRef = useRef(targetHeightAgl);
  targetHeightRef.current = targetHeightAgl;
  const activeCollectorRef = useRef(activeCollectorIdx);
  activeCollectorRef.current = activeCollectorIdx;
  const activeCollectorsRef = useRef(activeCollectors);
  activeCollectorsRef.current = activeCollectors;
  const obstructionRef = useRef(obstructionHeightM);
  obstructionRef.current = obstructionHeightM;
  const viewQuestionRef = useRef(viewQuestion);
  viewQuestionRef.current = viewQuestion;
  const singleDetailRef = useRef(singleDetail);
  singleDetailRef.current = singleDetail;
  const mapPickWaitingRef = useRef(mapPickWaitingIdx);
  mapPickWaitingRef.current = mapPickWaitingIdx;
  const showEditorRef = useRef(showEditor);
  showEditorRef.current = showEditor;

  const keysRef = useRef<{ i: boolean; t: boolean }>({ i: false, t: false });

  const syncSet = {
    viewQuestion: (v: string) => {
      setViewQuestion(v);
      viewQuestionRef.current = v;
    },
    singleDetail: (v: string) => {
      setSingleDetail(v);
      singleDetailRef.current = v;
    },
    targetHeight: (v: number) => {
      setTargetHeightAgl(v);
      targetHeightRef.current = v;
    },
    obstruction: (v: number) => {
      setObstructionHeightM(v);
      obstructionRef.current = v;
    },
    activeIdx: (v: number) => {
      setActiveCollectorIdx(v);
      activeCollectorRef.current = v;
    },
  };

  // --------------------------------------------------------------------------
  // Keyboard Listeners
  // --------------------------------------------------------------------------
  useEffect(() => {
    terrainProviderRef.current = new TerrariumTerrainProvider();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "i" && !e.repeat) keysRef.current.i = true;
      if (e.key.toLowerCase() === "t" && !e.repeat) keysRef.current.t = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "i") keysRef.current.i = false;
      if (e.key.toLowerCase() === "t") keysRef.current.t = false;
    };
    const handleBlur = () => {
      // Un-stick keys if the user clicks away from the browser
      keysRef.current.i = false;
      keysRef.current.t = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // --------------------------------------------------------------------------
  // Worker Initialization
  // --------------------------------------------------------------------------
  useEffect(() => {
    workerRef.current = new Worker(
      new URL("./workers/viewshed.worker.ts", import.meta.url),
      {
        type: "module",
      }
    );

    workerRef.current.onmessage = (event) => {
      try {
        if (!event.data) return;

        const payload = event.data.payload || event.data;
        const { runId } = payload;

        // 1. Immediately ignore any messages from obsolete, cancelled runs
        if (runId !== undefined && runId !== runIdRef.current) return;

        if (event.data.type === "COMPUTE_COMPLETE") {
          const { buffer, nx, ny, bounds } = payload;

          if (buffer && nx && ny && bounds) {
            const canvas = document.createElement("canvas");
            canvas.width = nx;
            canvas.height = ny;
            const ctx = canvas.getContext("2d");

            if (ctx) {
              const clampedArray = new Uint8ClampedArray(buffer);
              const imageData = new ImageData(clampedArray, nx, ny);
              ctx.putImageData(imageData, 0, 0);

              canvas.toBlob((blob) => {
                // 2. Guarantee the UI clears out of the "Computing" state,
                // even if the blob serialization somehow fails
                if (runId === runIdRef.current) {
                  isComputingRef.current = false;
                  setIsComputing(false);

                  if (blob && mapRef.current) {
                    const blobUrl = URL.createObjectURL(blob);
                    visibilityLayerRef.current.setSource(
                      new ImageStatic({
                        url: blobUrl,
                        imageExtent: bounds,
                        projection: "EPSG:3857",
                      })
                    );
                    visibilityLayerRef.current.changed();
                    mapRef.current.render();
                  }
                }
              }, "image/png");

              return; // Crucial: return here so we don't prematurely hit the fallback
            }
          }
        } else if (event.data.type === "COMPUTE_FAILED") {
          console.error("Worker Computation Error:", payload.error);
        }

        // 3. Fallback: If we reached here (missing buffer, failed ctx, or COMPUTE_FAILED),
        // and we are the active run, reset the UI to Idle.
        isComputingRef.current = false;
        setIsComputing(false);
      } catch (err) {
        console.error("Worker message parsing failed:", err);
        isComputingRef.current = false;
        setIsComputing(false);
      }
    };
    return () => workerRef.current?.terminate();
  }, []);

  // --------------------------------------------------------------------------
  // Worker Trigger Dispatcher
  // --------------------------------------------------------------------------
  const triggerCompute = useCallback((force = false) => {
    if (!mapRef.current || !workerRef.current) return;

    const activeIdxs = Array.from(activeCollectorsRef.current).sort();
    if (activeIdxs.length === 0) {
      visibilityLayerRef.current.setVisible(false);
      visibilityLayerRef.current.setSource(null);
      isComputingRef.current = false;
      setIsComputing(false);
      return;
    }

    visibilityLayerRef.current.setVisible(true);

    const map = mapRef.current;
    const view = map.getView();
    const mapSize = map.getSize();

    if (!mapSize || mapSize[0] <= 0 || mapSize[1] <= 0) return;

    let computeIdx = activeCollectorRef.current;
    if (!activeIdxs.includes(computeIdx)) {
      computeIdx = activeIdxs[0];
      syncSet.activeIdx(computeIdx);
    }

    const extent3857 = view.calculateExtent(mapSize);
    const extentKey =
      extent3857.map((n: number) => Math.round(n / 100) * 100).join(",") +
      `_q:${viewQuestionRef.current}_sd:${
        singleDetailRef.current
      }_obs:${activeIdxs.join("-")}_active:${computeIdx}_tgt:${
        targetHeightRef.current
      }_obsM:${obstructionRef.current}_clr:${observersRef.current
        .map((observer) => observer.antennaHeightAglM)
        .join("-")}`;

    if (extentKey === lastExtentStrRef.current && !force) return;
    lastExtentStrRef.current = extentKey;

    const swRaw = toLatLon([extent3857[0], extent3857[1]]);
    const neRaw = toLatLon([extent3857[2], extent3857[3]]);

    const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
    const sw = [swRaw[0], wrapLon(swRaw[1])];
    const ne = [neRaw[0], wrapLon(neRaw[1])];

    runIdRef.current += 1;
    const currentRunId = runIdRef.current;

    isComputingRef.current = true;
    setIsComputing(true);

    workerRef.current.postMessage({
      type: "COMPUTE_VIEWSHED",
      payload: {
        runId: currentRunId,
        extent: extent3857,
        extentLatLon: {
          latMin: sw[0],
          lonMin: sw[1],
          latMax: ne[0],
          lonMax: ne[1],
        },
        resolution: view.getResolution(),
        widthPx: mapSize[0],
        heightPx: mapSize[1],
        observers: observersRef.current,
        activeCollectorIndices: activeIdxs,
        activeCollectorIdx: activeCollectorRef.current,
        targetHeightAgl: targetHeightRef.current,
        obstructionHeightAglM: obstructionRef.current,
        viewQuestion: viewQuestionRef.current,
        singleDetail: singleDetailRef.current,
      },
    });
  }, []);

  const invalidateAndRecompute = useCallback(() => {
    lastExtentStrRef.current = "";
    if (debounceTimerRef.current !== null)
      window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(
      () => triggerCompute(true),
      50
    );
  }, [triggerCompute]);

  // --------------------------------------------------------------------------
  // Exact DEM Line Sampling Logic (Curvature Adjusted)
  // --------------------------------------------------------------------------
  const fetchDemProfile = async (
    obs: Observer,
    tgtLat: number,
    tgtLon: number,
    distM: number
  ) => {
    const { obstructionHeightAglM } = validateViewshedHeightParameters({
      collectorClearanceM: obs.antennaHeightAglM,
      obstructionHeightAglM: obstructionRef.current,
    });
    if (!terrainProviderRef.current) throw new Error("Provider not ready");
    const provider = terrainProviderRef.current;

    // 1. Cap the profile graph to the final 300km for high-altitude/space sensors
    const MAX_PROFILE_DIST = 300_000;
    const profileLengthM = Math.min(distM, MAX_PROFILE_DIST);

    // Dynamic sampling: high-res 500m spacing for the local graph
    let samples = Math.ceil(profileLengthM / 500);
    samples = Math.max(100, Math.min(samples, 600));

    const actualSpacingM = profileLengthM / samples;
    let zoom = Math.floor(Math.log2(40075016.68 / (256 * actualSpacingM)));
    zoom = Math.max(5, Math.min(14, zoom));

    const obsXM = lonToMercatorX(obs.longitude_deg);
    const obsYM = latToMercatorY(obs.latitude_deg);
    const tgtXM = lonToMercatorX(tgtLon);
    const tgtYM = latToMercatorY(tgtLat);

    const xs = new Float64Array(samples + 1);
    const ys = new Float64Array(samples + 1);

    // Interpolate from the horizon cut-off point down to the target
    const startF = 1.0 - profileLengthM / Math.max(1, distM);

    for (let i = 0; i <= samples; i++) {
      const stepF = i / samples;
      const f = startF + stepF * (profileLengthM / Math.max(1, distM));
      xs[i] = obsXM + (tgtXM - obsXM) * f;
      ys[i] = obsYM + (tgtYM - obsYM) * f;
    }

    const elevations = await provider.sampleGrid(xs, ys, zoom);

    let finalObsAlt = obs.altitude_m;
    if (obs.kind === "ground") {
      const rawObsTerrain = await provider.samplePoint(obsXM, obsYM, zoom);
      finalObsAlt = groundCollectorElevationM(
        rawObsTerrain,
        obs.antennaHeightAglM
      );
    }
    const finalTgtAlt =
      Math.max(0, elevations[samples]) + targetHeightRef.current * 1000;

    // 2. Exact Spherical Polar Math for Earth Curvature
    const R = 6371000;
    const At = R + finalTgtAlt;
    const Ao = R + finalObsAlt;
    const Theta = distM / R;

    let Minv = 0;
    if (Theta > 1e-7) {
      Minv = (Ao * Math.cos(Theta) - At) / (Ao * Math.sin(Theta));
    }

    const points: { x: number; y: number; rayAlt: number }[] = [];
    let minElev = Math.min(finalObsAlt, finalTgtAlt);
    let maxElev = 0;
    let isBlocked = false;

    for (let i = 0; i <= samples; i++) {
      const elev = modeledProfileElevationM(
        elevations[i],
        i,
        samples,
        obstructionHeightAglM
      );

      const surfDistFromTgt = profileLengthM * (1.0 - i / samples);
      const theta = surfDistFromTgt / R;
      const denom = Math.cos(theta) - Minv * Math.sin(theta);

      let rayAlt = -R; // Plunge underground if infinite
      if (denom > 0) {
        rayAlt = At / denom - R;
      }

      // FIX 1: Remove the 150m blindspot.
      // Dynamically ignore only the exact first and last sample indices to prevent
      // pixel self-shadowing, and add a 0.5m grazing tolerance.
      if (i > 0 && i < samples) {
        if (rayAlt < 0 || elev > rayAlt + 0.5) {
          isBlocked = true;
        }
      }

      points.push({ x: distM - surfDistFromTgt, y: elev, rayAlt });

      // FIX 2: Stop forcing the graph to track underground rays.
      // Only track the physical terrain to calculate the tightest possible zoom bounds.
      minElev = Math.min(minElev, elev);
      maxElev = Math.max(maxElev, elev);
    }
    // FIX 3: Smart Y-Axis scaling.
    // Floating-point math means startF is rarely exactly 0 (e.g., 1.11e-16).
    // We must check physical distance to prevent ground links from being
    // treated like space links!
    const isFullProfile = profileLengthM >= distM - 0.5;

    let graphMaxElev = Math.max(finalTgtAlt, maxElev);

    if (isFullProfile) {
      // Ground/Aircraft links: Use a tight 20% margin above the highest peak
      const elevRange = Math.max(20, graphMaxElev - minElev);
      graphMaxElev = Math.max(graphMaxElev, finalObsAlt) + elevRange * 0.2;

      // Add a 5% bottom margin so the terrain doesn't touch the floor of the SVG
      minElev = Math.max(0, minElev - elevRange * 0.05);
    } else {
      // Space/GEO links: Add 1500m of headroom so the ray plunges from the ceiling
      graphMaxElev += 1500;
    }

    return {
      profile: points,
      profileLengthM,
      minElev,
      maxElev: graphMaxElev,
      isBlocked,
      finalObsAlt,
      finalTgtAlt,
    };
  };

  // --------------------------------------------------------------------------
  // Map Initialization & Event Setup
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!mapTargetRef.current) return;

    const map = new Map({
      target: mapTargetRef.current,
      moveTolerance: 5,
      layers: [
        osmLayerRef.current,
        visibilityLayerRef.current,
        validationLayerRef.current,
        collectorLayerRef.current,
      ],
      view: new View({
        center: fromLonLat([-104.9903, 39.7392]),
        zoom: 8,
      }),
    });
    mapRef.current = map;

    map.on("click", (evt) => {
      const [lon, lat] = toLonLat(evt.coordinate);
      const vSource = validationLayerRef.current.getSource();

      // 1. Editor Map Pick (Only execute if Editor is actually open)
      if (mapPickWaitingRef.current !== null) {
        if (!showEditorRef.current) {
          // Clean up if they closed the editor while waiting for a click
          setMapPickWaitingIdx(null);
          mapPickWaitingRef.current = null;
          map.getTargetElement().style.cursor = "";
        } else {
          const idx = mapPickWaitingRef.current;
          const updated = [...observersRef.current];
          updated[idx] = {
            ...updated[idx],
            latitude_deg: lat,
            longitude_deg: lon,
          };
          setObservers(updated);
          observersRef.current = updated;
          setMapPickWaitingIdx(null);
          mapPickWaitingRef.current = null;
          map.getTargetElement().style.cursor = "";
          setInspectorText(
            `Updated ${updated[idx].name} to ${lat.toFixed(5)}, ${lon.toFixed(
              5
            )}`
          );
          vSource?.clear();
          invalidateAndRecompute();
          return;
        }
      }

      // 2. 'T' (Teleport) Modifier (Block if Editor is closed)
      if (keysRef.current.t) {
        if (!showEditorRef.current) {
          setInspectorText("Editor must be open to move collectors.");
          // Do not return here; let it fall through to clean up the blue dot in step 4
        } else {
          const idx = activeCollectorRef.current;
          const updated = [...observersRef.current];
          updated[idx] = {
            ...updated[idx],
            latitude_deg: lat,
            longitude_deg: lon,
          };
          setObservers(updated);
          observersRef.current = updated;
          setInspectorText(
            `Teleported ${updated[idx].name} to ${lat.toFixed(
              5
            )}, ${lon.toFixed(5)}`
          );
          vSource?.clear();
          invalidateAndRecompute();
          return;
        }
      }

      // 3. 'I' (Inspect) Modifier
      // ... (Keep your existing Inspect and Default Click logic exactly as is)
      // 3. 'I' (Inspect) Modifier
      if (keysRef.current.i) {
        const activeIdxs = Array.from(activeCollectorsRef.current);
        if (activeIdxs.length === 0) return;

        setInspectorText(
          `Inspecting Profile Target: ${lat.toFixed(6)}°, ${lon.toFixed(6)}°`
        );

        // Clear any old lines/dots before drawing the new ones
        vSource?.clear();

        // ONLY draw the blue dot if 'I' is pressed
        const targetFeature = new Feature(new Point(evt.coordinate));
        targetFeature.setStyle(
          new Style({
            image: new CircleStyle({
              radius: 7,
              fill: new Fill({ color: "#2563eb" }),
              stroke: new Stroke({ color: "#ffffff", width: 2 }),
            }),
          })
        );
        vSource?.addFeature(targetFeature);

        activeIdxs.forEach((idx) => {
          const obs = observersRef.current[idx];
          const obsCoord = fromLonLat([obs.longitude_deg, obs.latitude_deg]);
          const lineFeature = new Feature(
            new LineString([obsCoord, evt.coordinate])
          );
          lineFeature.setStyle(
            new Style({
              stroke: new Stroke({
                color: obs.color,
                width: 2,
                lineDash: [4, 4],
              }),
            })
          );
          vSource?.addFeature(lineFeature);
        });

        validationLayerRef.current.changed();
        map.renderSync();

        const initialResults: ProfileResult[] = activeIdxs.map((idx) => {
          const obs = observersRef.current[idx];
          const distM = haversineDistanceM(
            obs.latitude_deg,
            obs.longitude_deg,
            lat,
            lon
          );
          return {
            idx,
            loading: true,
            obsName: obs.name,
            obsAlt: obs.altitude_m,
            tgtAlt: targetHeightRef.current * 1000,
            distM,
            profileLengthM: distM,
            profile: [],
            minElev: 0,
            maxElev: 0,
            isBlocked: false,
          };
        });

        setProfileData({ active: true, results: initialResults });
        setActiveProfileTab(0);

        activeIdxs.forEach((idx) => {
          const obs = observersRef.current[idx];
          const distM = haversineDistanceM(
            obs.latitude_deg,
            obs.longitude_deg,
            lat,
            lon
          );
          fetchDemProfile(obs, lat, lon, distM)
            .then((data) => {
              setProfileData((prev) => {
                if (!prev) return prev;
                const updatedResults = [...prev.results];
                const tIdx = updatedResults.findIndex((r) => r.idx === idx);
                if (tIdx !== -1) {
                  updatedResults[tIdx] = {
                    ...updatedResults[tIdx],
                    loading: false,
                    profile: data.profile,
                    profileLengthM: data.profileLengthM,
                    minElev: data.minElev,
                    maxElev: data.maxElev,
                    isBlocked: data.isBlocked,
                    obsAlt: data.finalObsAlt,
                    tgtAlt: data.finalTgtAlt,
                  };
                }
                return { ...prev, results: updatedResults };
              });
            })
            .catch(() => {});
        });
        return;
      }
      // ... (Keep the map.on("click") block exactly as is)

      // 4. Default plain click (No Modifiers)
      vSource?.clear();
      validationLayerRef.current.changed();
      map.renderSync();
      setProfileData(null);
      setInspectorText("Hold 'I' + Click to see LOS. ");
    });

    const handleMapChange = () => {
      if (debounceTimerRef.current !== null)
        window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(
        () => triggerCompute(),
        400
      );
    };

    map.on("moveend", handleMapChange);
    map.on("change:size", handleMapChange); // Catch browser window resizing

    // FIX: Force the initial compute safely after the DOM layout settles
    // instead of waiting for flaky base map tiles to download
    const initTimer = window.setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.updateSize();
        invalidateAndRecompute();
      }
    }, 150);

    return () => {
      window.clearTimeout(initTimer);
      map.setTarget(undefined);
      if (debounceTimerRef.current !== null)
        window.clearTimeout(debounceTimerRef.current);
    };
  }, [triggerCompute, invalidateAndRecompute]); // Ensure dependency array includes both

  useEffect(() => {
    const source = collectorLayerRef.current.getSource();
    source?.clear();
    observers.forEach((obs, idx) => {
      const isEnabled = activeCollectors.has(idx);
      const isInspected = idx === activeCollectorIdx;

      const feature = new Feature(
        new Point(fromLonLat([obs.longitude_deg, obs.latitude_deg]))
      );
      feature.setStyle(
        new Style({
          image: new CircleStyle({
            radius: obs.kind === "aircraft" ? 8.5 : 7.0,
            fill: new Fill({ color: isEnabled ? obs.color : "#94a3b8" }),
            stroke: new Stroke({
              color: isInspected ? "#ffea00" : "#ffffff",
              width: isInspected ? 3 : 2,
            }),
          }),
        })
      );
      source?.addFeature(feature);
    });
  }, [observers, activeCollectors, activeCollectorIdx]);

  // --------------------------------------------------------------------------
  // Selection Control Handlers
  // --------------------------------------------------------------------------
  const toggleCollector = (idx: number) => {
    const updated = new Set(activeCollectorsRef.current);
    if (updated.has(idx)) updated.delete(idx);
    else updated.add(idx);
    setActiveCollectors(updated);
    activeCollectorsRef.current = updated;
    invalidateAndRecompute();
  };

  const handleAddCollector = () => {
    // Determine spawn coordinates (defaulting to the first observer's location)
    const spawnLat = observersRef.current[0]?.latitude_deg || 39.7392;
    const spawnLon = observersRef.current[0]?.longitude_deg || -104.9903;

    // Pick a random distinct color for the new trace
    const colors = [
      "#9333ea",
      "#ea580c",
      "#0ea5e9",
      "#06b6d4",
      "#ec4899",
      "#14b8a6",
    ];
    const randomColor = colors[observersRef.current.length % colors.length];

    const newObserver: Observer = {
      name: `Collector ${observersRef.current.length + 1}`,
      kind: "ground",
      latitude_deg: spawnLat,
      longitude_deg: spawnLon,
      altitude_m: 0,
      antennaHeightAglM: 10,
      color: randomColor,
    };

    const updatedObservers = [...observersRef.current, newObserver];
    setObservers(updatedObservers);
    observersRef.current = updatedObservers;

    // Automatically check the box for the new collector
    const updatedActive = new Set(activeCollectorsRef.current);
    updatedActive.add(updatedObservers.length - 1);
    setActiveCollectors(updatedActive);
    activeCollectorsRef.current = updatedActive;

    invalidateAndRecompute();
  };

  const handleDeleteCollector = (indexToRemove: number) => {
    // Prevent deleting the very last observer to avoid crashing the app
    if (observersRef.current.length <= 1) return;

    // 1. Remove the observer from the array
    const updatedObservers = observersRef.current.filter(
      (_, idx) => idx !== indexToRemove
    );
    setObservers(updatedObservers);
    observersRef.current = updatedObservers;

    // 2. Shift the active checkboxes down to match the new array structure
    const updatedActive = new Set<number>();
    activeCollectorsRef.current.forEach((idx) => {
      if (idx < indexToRemove) {
        updatedActive.add(idx); // Unchanged
      } else if (idx > indexToRemove) {
        updatedActive.add(idx - 1); // Shifted down
      }
    });
    setActiveCollectors(updatedActive);
    activeCollectorsRef.current = updatedActive;

    // 3. Clean up the single-inspector/teleport pointer using your syncSet helper
    if (activeCollectorRef.current === indexToRemove) {
      syncSet.activeIdx(0);
    } else if (activeCollectorRef.current > indexToRemove) {
      syncSet.activeIdx(activeCollectorRef.current - 1);
    }

    // 4. Clean up Map Pick pointer
    if (mapPickWaitingRef.current === indexToRemove) {
      setMapPickWaitingIdx(null);
      mapPickWaitingRef.current = null;
      if (mapRef.current) mapRef.current.getTargetElement().style.cursor = "";
    } else if (
      mapPickWaitingRef.current !== null &&
      mapPickWaitingRef.current > indexToRemove
    ) {
      setMapPickWaitingIdx(mapPickWaitingRef.current - 1);
      mapPickWaitingRef.current -= 1;
    }

    invalidateAndRecompute();
  };

  const handleObserverEdit = (
    idx: number,
    field: keyof Observer,
    value: any
  ) => {
    const updated = [...observersRef.current];
    updated[idx] = { ...updated[idx], [field]: value };
    setObservers(updated);
    observersRef.current = updated;

    if (field !== "name" && field !== "color") {
      invalidateAndRecompute();
    }
  };

  const commitAntennaHeight = (idx: number) => {
    const draft = antennaHeightDrafts[idx];
    if (draft === undefined) return;
    const heightM = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(heightM) || heightM < 0) return;
    handleObserverEdit(idx, "antennaHeightAglM", heightM);
    setAntennaHeightDrafts((current) => {
      const next = { ...current };
      delete next[idx];
      return next;
    });
  };

  const lookupGroundElevation = async (idx: number) => {
    const observer = observersRef.current[idx];
    const provider = terrainProviderRef.current;
    if (!observer || observer.kind !== "ground" || !provider) return;

    const elevationM = await provider.samplePoint(
      lonToMercatorX(observer.longitude_deg),
      latToMercatorY(observer.latitude_deg),
      14
    );
    if (!Number.isFinite(elevationM)) return;

    const updated = [...observersRef.current];
    updated[idx] = { ...observer, altitude_m: Math.max(0, elevationM) };
    setObservers(updated);
    observersRef.current = updated;
    setInspectorText(
      `${observer.name} DEM elevation: ${Math.max(0, elevationM).toFixed(1)} m`
    );
    invalidateAndRecompute();
  };

  const triggerMapPick = (idx: number) => {
    setMapPickWaitingIdx(idx);
    mapPickWaitingRef.current = idx;
    if (mapRef.current) {
      mapRef.current.getTargetElement().style.cursor = "crosshair";
    }
    setInspectorText(
      `Waiting for map click... (will update ${observers[idx].name})`
    );
  };

  // --------------------------------------------------------------------------
  // Rendering Extraction
  // --------------------------------------------------------------------------
  const renderActiveTabContent = () => {
    const activeRes = profileData?.results[activeProfileTab];
    if (activeRes === undefined || activeRes === null) {
      return null;
    }

    if (activeRes.loading) {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "bold",
            color: "#64748b",
          }}
        >
          Sampling Exact DEM Terrain...
        </div>
      );
    }

    const activeObsColor =
      observersRef.current[activeRes.idx]?.color || "#7c3aed";

    let terrainPathD = "M 0,100 L 100,100 Z";
    let rayPathD = "";
    let obsY = 100,
      tgtY = 100;

    if (activeRes.profile.length > 0) {
      const pY = (elev: number) => {
        const range = activeRes.maxElev - activeRes.minElev || 1;
        // Clamp visuals so space rays cleanly exit the ceiling
        const mappedY = 90 - ((elev - activeRes.minElev) / range) * 80;
        return Math.max(-10, Math.min(110, mappedY));
      };

      terrainPathD =
        `M 0,100 ` +
        activeRes.profile
          .map(
            (p, i) =>
              `L ${(i / (activeRes.profile.length - 1)) * 100},${pY(p.y)}`
          )
          .join(" ") +
        ` L 100,100 Z`;

      // Plot the Ray as a true curve
      rayPathD =
        `M 0,${pY(activeRes.profile[0].rayAlt)} ` +
        activeRes.profile
          .map(
            (p, i) =>
              `L ${(i / (activeRes.profile.length - 1)) * 100},${pY(p.rayAlt)}`
          )
          .join(" ");

      obsY = pY(activeRes.profile[0].rayAlt);
      tgtY = pY(activeRes.profile[activeRes.profile.length - 1].rayAlt);
    }

    const isOffscreen = activeRes.distM > activeRes.profileLengthM + 10;
    const leftLabel = isOffscreen
      ? `Ray entering atmosphere (<-- ${activeRes.obsName})`
      : `${activeRes.obsName} (${formatElev(activeRes.obsAlt)})`;

    return (
      <>
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, overflow: "visible" }}
        >
          <path
            d={terrainPathD}
            fill="#cbd5e1"
            stroke="#94a3b8"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={rayPathD}
            fill="none"
            stroke={activeRes.isBlocked ? "#dc2626" : activeObsColor}
            strokeWidth="3"
            strokeDasharray="6,4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div
          style={{
            position: "absolute",
            left: "0%",
            top: `${obsY}%`,
            transform: "translate(-50%, -100%)",
            zIndex: 10,
          }}
        >
          <HtmlPin color={isOffscreen ? "#94a3b8" : activeObsColor} />
        </div>
        <div
          style={{
            position: "absolute",
            left: "0%",
            top: `${obsY}%`,
            transform: "translate(15px, -24px)",
            fontWeight: "bold",
            color: "#1e293b",
            fontSize: "13px",
            textShadow:
              "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff",
            whiteSpace: "nowrap",
            zIndex: 10,
          }}
        >
          {leftLabel}
        </div>

        <div
          style={{
            position: "absolute",
            left: "100%",
            top: `${tgtY}%`,
            transform: "translate(-50%, -100%)",
            zIndex: 10,
          }}
        >
          <HtmlPin color="#2563eb" />
        </div>
        <div
          style={{
            position: "absolute",
            left: "100%",
            top: `${tgtY}%`,
            transform: "translate(-15px, -24px) translateX(-100%)",
            fontWeight: "bold",
            color: "#1e293b",
            fontSize: "13px",
            textShadow:
              "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff",
            whiteSpace: "nowrap",
            zIndex: 10,
          }}
        >
          Target ({formatElev(activeRes.tgtAlt)})
        </div>

        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "10px",
            transform: "translateX(-50%)",
            background: "rgba(255,255,255,0.95)",
            padding: "4px 12px",
            borderRadius: "12px",
            fontSize: "13px",
            color: "#334155",
            border: "1px solid #94a3b8",
            fontWeight: "bold",
            zIndex: 10,
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          }}
        >
          Range: {(activeRes.distM / 1000).toFixed(2)} km | Status:{" "}
          <span style={{ color: activeRes.isBlocked ? "#dc2626" : "#16a34a" }}>
            {activeRes.isBlocked ? "BLOCKED" : "VISIBLE"}
          </span>
        </div>
      </>
    );
  };

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        fontFamily: "sans-serif",
        position: "relative",
      }}
    >
      {/* App Header Controls */}
      <section
        style={{
          padding: "8px 12px",
          background: "#f1f5f9",
          borderBottom: "1px solid #cbd5e1",
          fontSize: "13px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          zIndex: 10,
        }}
      >
        {/* Main Controls Row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ position: "relative" }}>
            <label style={{ fontWeight: "bold", marginRight: "6px" }}>
              Observers:
            </label>
            <button
              onClick={() => setObserversDropdownOpen(!observersDropdownOpen)}
              style={{
                padding: "3px 8px",
                background: "#ffffff",
                border: "1px solid #94a3b8",
                borderRadius: "4px",
                cursor: "pointer",
                minWidth: "160px",
                textAlign: "left",
              }}
            >
              {activeCollectors.size === 0
                ? "None"
                : activeCollectors.size === observers.length
                ? `All (${observers.length})`
                : `${activeCollectors.size} selected`}{" "}
              ▾
            </button>

            {observersDropdownOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: "70px",
                  marginTop: "4px",
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                  padding: "8px",
                  zIndex: 50,
                  minWidth: "220px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    marginBottom: "8px",
                    borderBottom: "1px solid #e2e8f0",
                    paddingBottom: "8px",
                  }}
                >
                  <button
                    onClick={() => {
                      const all = new Set(observers.map((_, i) => i));
                      setActiveCollectors(all);
                      activeCollectorsRef.current = all;
                      invalidateAndRecompute();
                    }}
                    style={{
                      flex: 1,
                      padding: "4px",
                      background: "#e2e8f0",
                      border: "1px solid #94a3b8",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    All
                  </button>
                  <button
                    onClick={() => {
                      const none = new Set<number>();
                      setActiveCollectors(none);
                      activeCollectorsRef.current = none;
                      visibilityLayerRef.current.setSource(null);
                      visibilityLayerRef.current.changed();
                      setIsComputing(false);
                      isComputingRef.current = false;
                    }}
                    style={{
                      flex: 1,
                      padding: "4px",
                      background: "#e2e8f0",
                      border: "1px solid #94a3b8",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    None
                  </button>
                </div>
                {observers.map((obs, idx) => (
                  <label
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "4px 0",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={activeCollectors.has(idx)}
                      onChange={() => toggleCollector(idx)}
                      style={{ marginRight: "8px" }}
                    />
                    <span
                      style={{
                        display: "inline-block",
                        width: "12px",
                        height: "12px",
                        borderRadius: "50%",
                        background: obs.color,
                        marginRight: "8px",
                      }}
                    />
                    {obs.name}
                  </label>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowEditor(!showEditor)}
              style={{
                marginLeft: "8px",
                padding: "3px 8px",
                background: "#e2e8f0",
                border: "1px solid #94a3b8",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Edit...
            </button>
          </div>

          <div>
            <label style={{ fontWeight: "bold", marginRight: "6px" }}>
              Map Question:
            </label>
            <select
              value={viewQuestion}
              onChange={(e) => {
                syncSet.viewQuestion(e.target.value);
                invalidateAndRecompute();
              }}
              style={{
                padding: "3px 6px",
                border: "1px solid #94a3b8",
                borderRadius: "4px",
              }}
            >
              <option value="coverage-all">Visible to every observer</option>
              <option value="coverage-any">Visible to any observer</option>
              <option value="single">Inspect one observer</option>
            </select>
          </div>

          <div>
            <label style={{ fontWeight: "bold", marginRight: "6px" }}>
              Target Height:
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={targetHeightDraft}
              onChange={(e) => {
                setTargetHeightDraft(e.target.value);
                setTargetHeightInputState("dirty");
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setTargetHeightDraft(String(targetHeightRef.current));
                  setTargetHeightInputState("clean");
                  return;
                }
                if (e.key !== "Enter") return;

                const nextHeight = Number(targetHeightDraft);
                if (
                  targetHeightDraft.trim() === "" ||
                  !Number.isFinite(nextHeight) ||
                  nextHeight < 0
                ) {
                  setTargetHeightInputState("invalid");
                  return;
                }

                syncSet.targetHeight(nextHeight);
                setTargetHeightDraft(String(nextHeight));
                setTargetHeightInputState("clean");
                invalidateAndRecompute();
              }}
              title="Target height above the sampled DEM. Press Enter to update the viewshed."
              style={{
                width: "80px",
                padding: "3px",
                border: `1px solid ${
                  targetHeightInputState === "invalid"
                    ? "#dc2626"
                    : targetHeightInputState === "dirty"
                    ? "#d97706"
                    : "#94a3b8"
                }`,
                background:
                  targetHeightInputState === "invalid"
                    ? "#fef2f2"
                    : targetHeightInputState === "dirty"
                    ? "#fffbeb"
                    : "#ffffff",
                borderRadius: "4px",
              }}
            />
            <span
              style={{ marginLeft: "4px" }}
              title="Target height above the sampled DEM."
            >
              km
            </span>
          </div>

          <button
            onClick={() => setAdvancedExpanded(!advancedExpanded)}
            style={{
              marginLeft: "auto",
              padding: "4px 10px",
              background: "#e2e8f0",
              border: "1px solid #94a3b8",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {advancedExpanded ? "Settings ▾" : "Settings ▸"}
          </button>
        </div>

        {viewQuestion === "single" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              paddingTop: "6px",
              borderTop: "1px solid #cbd5e1",
            }}
          >
            <label>Observer to inspect:</label>
            <select
              value={activeCollectorIdx}
              onChange={(e) => {
                syncSet.activeIdx(Number(e.target.value));
                invalidateAndRecompute();
              }}
              style={{
                padding: "3px 6px",
                border: "1px solid #94a3b8",
                borderRadius: "4px",
              }}
            >
              {observers.map((obs, idx) => (
                <option key={idx} value={idx}>
                  {obs.name} ({obs.kind})
                </option>
              ))}
            </select>

            <label style={{ marginLeft: "12px" }}>Detail:</label>
            <select
              value={singleDetail}
              onChange={(e) => {
                syncSet.singleDetail(e.target.value);
                invalidateAndRecompute();
              }}
              style={{
                padding: "3px 6px",
                border: "1px solid #94a3b8",
                borderRadius: "4px",
              }}
            >
              <option value="blocked">Blocked at target height</option>
              <option value="mva">Minimum visible altitude</option>
            </select>
          </div>
        )}

        {showEditor && (
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              padding: "16px",
              maxHeight: "360px",
              overflowY: "auto",
              borderRadius: "10px",
              boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "12px",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>
                  Collector geometry
                </div>
                <div style={{ color: "#64748b", marginTop: "2px" }}>
                  Configure positions and sensor heights for each collector.
                </div>
              </div>
              <button
                onClick={handleAddCollector}
                style={{
                  padding: "7px 12px",
                  backgroundColor: "#2563eb",
                  border: "1px solid #1d4ed8",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 700,
                  color: "#ffffff",
                }}
              >
                + Add Collector
              </button>
            </div>
            <table
              style={{
                width: "100%",
                textAlign: "left",
                borderCollapse: "separate",
                borderSpacing: 0,
                tableLayout: "fixed",
              }}
            >
              <thead>
                <tr style={{ background: "#f1f5f9", color: "#475569" }}>
                  <th style={{ padding: "8px", width: "48px" }}>Color</th>
                  <th style={{ padding: "8px", width: "140px" }}>Name</th>
                  <th style={{ padding: "8px", width: "90px" }}>Type</th>
                  <th style={{ padding: "8px", width: "120px" }}>Latitude</th>
                  <th style={{ padding: "8px", width: "120px" }}>Longitude</th>
                  <th style={{ padding: "8px", width: "280px" }}>Sensor height</th>
                  <th style={{ padding: "8px", width: "110px" }}>Position</th>
                  <th style={{ padding: "8px", width: "44px" }}></th>{" "}
                  {/* Empty header for trashcan */}
                </tr>
              </thead>
              <tbody>
                {observers.map((obs, idx) => (
                  <tr key={idx} style={{ background: idx % 2 ? "#f8fafc" : "#ffffff" }}>
                    <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                      <input
                        type="color"
                        value={obs.color}
                        onChange={(e) =>
                          handleObserverEdit(idx, "color", e.target.value)
                        }
                        style={{
                          width: "28px",
                          height: "28px",
                          padding: "0",
                          border: "none",
                          cursor: "pointer",
                        }}
                      />
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                      <input
                        type="text"
                        value={obs.name}
                        onChange={(e) =>
                          handleObserverEdit(idx, "name", e.target.value)
                        }
                        style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: "5px" }}
                      />
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                      <select
                        value={obs.kind}
                        onChange={(e) => {
                          const kind = e.target.value as Observer["kind"];
                          const updated = [...observersRef.current];
                          updated[idx] = {
                            ...updated[idx],
                            kind,
                            altitude_m:
                              kind === "aircraft" ? 9144 : updated[idx].altitude_m,
                          };
                          setObservers(updated);
                          observersRef.current = updated;
                          invalidateAndRecompute();
                        }}
                        style={{ width: "100%", padding: "6px", border: "1px solid #cbd5e1", borderRadius: "5px" }}
                      >
                        <option value="ground">Ground</option>
                        <option value="aircraft">Aircraft</option>
                        <option value="leo">LEO</option>
                        <option value="geo">GEO</option>
                      </select>
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                      <input
                        type="number"
                        step="0.0001"
                        value={obs.latitude_deg}
                        onChange={(e) => {
                          handleObserverEdit(
                            idx,
                            "latitude_deg",
                            parseFloat(e.target.value)
                          );
                          invalidateAndRecompute();
                        }}
                        style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: "5px" }}
                        disabled={obs.kind === "geo"}
                      />
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                      <input
                        type="number"
                        step="0.0001"
                        value={obs.longitude_deg}
                        onChange={(e) => {
                          handleObserverEdit(
                            idx,
                            "longitude_deg",
                            parseFloat(e.target.value)
                          );
                          invalidateAndRecompute();
                        }}
                        style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: "5px" }}
                      />
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                      {obs.kind === "ground" ? (
                        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={antennaHeightDrafts[idx] ?? String(obs.antennaHeightAglM)}
                            title="Antenna height above the DEM at this collector"
                            onChange={(e) =>
                              setAntennaHeightDrafts((current) => ({
                                ...current,
                                [idx]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitAntennaHeight(idx);
                              if (e.key === "Escape")
                                setAntennaHeightDrafts((current) => {
                                  const next = { ...current };
                                  delete next[idx];
                                  return next;
                                });
                            }}
                            style={{
                              width: "72px",
                              padding: "6px 8px",
                              border: `2px solid ${
                                antennaHeightDrafts[idx] !== undefined
                                  ? "#f59e0b"
                                  : "#cbd5e1"
                              }`,
                              background:
                                antennaHeightDrafts[idx] !== undefined
                                  ? "#fef08a"
                                  : "#ffffff",
                              borderRadius: "5px",
                            }}
                          />
                          <span>m AGL</span>
                          <button
                            onClick={() => lookupGroundElevation(idx)}
                            title="Sample the DEM at this latitude and longitude"
                            style={{ padding: "6px 8px", cursor: "pointer", border: "1px solid #94a3b8", borderRadius: "5px", background: "#f8fafc" }}
                          >
                            Lookup DEM
                          </button>
                          <span title="Last sampled DEM elevation">
                            {Number.isFinite(obs.altitude_m)
                              ? `${obs.altitude_m.toFixed(0)} m DEM`
                              : "DEM unknown"}
                          </span>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                          <input
                            type="number"
                            step="1"
                            value={obs.altitude_m}
                            onChange={(e) =>
                              handleObserverEdit(
                                idx,
                                "altitude_m",
                                Number(e.target.value)
                              )
                            }
                            style={{ width: "80px", padding: "2px 4px" }}
                          />
                          <span>m MSL</span>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                      {obs.kind !== "geo" && (
                        <button
                          onClick={() => triggerMapPick(idx)}
                          style={{
                            background:
                              mapPickWaitingIdx === idx
                                ? "#fef08a"
                                : "#e2e8f0",
                            border: "1px solid #94a3b8",
                            padding: "2px 6px",
                            cursor: "pointer",
                            borderRadius: "4px",
                          }}
                        >
                          {mapPickWaitingIdx === idx
                            ? "Waiting..."
                            : "Pick on Map"}
                        </button>
                      )}
                    </td>
                    {/* Trashcan Delete Column */}
                    <td style={{ padding: "8px", textAlign: "center", borderBottom: "1px solid #e2e8f0" }}>
                      <button
                        onClick={() => handleDeleteCollector(idx)}
                        title="Delete Observer"
                        disabled={observers.length <= 1} // Prevent deleting the last one
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor:
                            observers.length <= 1 ? "not-allowed" : "pointer",
                          color: observers.length <= 1 ? "#cbd5e1" : "#ef4444",
                          fontSize: "16px",
                          padding: "2px 6px",
                        }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {advancedExpanded && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "8px",
              padding: "8px",
              background: "#e2e8f0",
              borderRadius: "4px",
            }}
          >
            <div>
              <label>Modeled Clutter Height: </label>
              <input
                type="number"
                min="0"
                value={obstructionHeightM}
                onChange={(e) => {
                  syncSet.obstruction(parseFloat(e.target.value) || 0);
                  invalidateAndRecompute();
                }}
                style={{ width: "60px", padding: "2px 4px" }}
                title="Uniform height added to all terrain to represent surface clutter (e.g., trees/buildings)."
              />{" "}
              m
            </div>
            <div>
              <label>Viewshed Opacity ({losOpacity}%): </label>
              <input
                type="range"
                min="0"
                max="100"
                value={losOpacity}
                onChange={(e) => {
                  setLosOpacity(Number(e.target.value));
                  visibilityLayerRef.current.setOpacity(
                    Number(e.target.value) / 100
                  );
                }}
                style={{ verticalAlign: "middle" }}
              />
            </div>
            <div>
              <label>Base Map Opacity ({baseMapOpacity}%): </label>
              <input
                type="range"
                min="0"
                max="100"
                value={baseMapOpacity}
                onChange={(e) => {
                  setBaseMapOpacity(Number(e.target.value));
                  osmLayerRef.current.setOpacity(Number(e.target.value) / 100);
                }}
                style={{ verticalAlign: "middle" }}
              />
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "12px",
            color: "#475569",
            background: "#fff6d8",
            padding: "6px",
            border: "1px solid #c79a28",
            borderRadius: "4px",
          }}
        >
          <span>{inspectorText}</span>
          <span
            style={{
              fontWeight: "bold",
              color: isComputing ? "#e34a33" : "#16a34a",
            }}
          >
            {isComputing ? "Computing ViewShed..." : "Idle"}
          </span>
        </div>
      </section>

      {/* OpenLayers Map Canvas */}
      <div style={{ flex: 1, width: "100%", position: "relative" }}>
        <div ref={mapTargetRef} style={{ width: "100%", height: "100%" }} />

        {/* Tabbed 2D Sightline Profile Panel */}
        {profileData && profileData.active && (
          <div
            style={{
              position: "absolute",
              bottom: "20px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "85%",
              maxWidth: "900px",
              height: "300px",
              background: "#ffffff",
              border: "1px solid #8a99aa",
              borderRadius: "6px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              display: "flex",
              flexDirection: "column",
              zIndex: 20,
            }}
          >
            {/* Header & Tabs */}
            <div
              style={{
                display: "flex",
                background: "#f1f5f9",
                borderBottom: "1px solid #cbd5e1",
                borderTopLeftRadius: "6px",
                borderTopRightRadius: "6px",
              }}
            >
              <div style={{ display: "flex", flex: 1, overflowX: "auto" }}>
                {profileData.results.map((res, i) => (
                  <button
                    key={res.idx}
                    onClick={() => setActiveProfileTab(i)}
                    style={{
                      padding: "8px 16px",
                      background:
                        activeProfileTab === i ? "#ffffff" : "transparent",
                      border: "none",
                      borderBottom:
                        activeProfileTab === i
                          ? `2px solid ${
                              observersRef.current[res.idx]?.color || "#3b82f6"
                            }`
                          : "2px solid transparent",
                      borderRight: "1px solid #cbd5e1",
                      cursor: "pointer",
                      fontWeight: activeProfileTab === i ? "bold" : "normal",
                      outline: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background:
                          observersRef.current[res.idx]?.color || "#3b82f6",
                        marginRight: "6px",
                      }}
                    />
                    {res.obsName} {res.loading && "(Loading...)"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setProfileData(null);
                  validationLayerRef.current.getSource()?.clear();
                  setInspectorText("Hold 'I' + Click to see LOS.");
                }}
                style={{
                  padding: "0 12px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "18px",
                  borderLeft: "1px solid #cbd5e1",
                }}
              >
                ×
              </button>
            </div>

            {/* Active Tab Content Area */}
            <div
              style={{
                flex: 1,
                position: "relative",
                margin: "24px 60px",
                border: "1px solid #cbd5e1",
                background: "linear-gradient(to bottom, #e0f2fe, #f8fafc)",
                borderRadius: "4px",
              }}
            >
              {renderActiveTabContent()}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<ViewshedApp />);
}
