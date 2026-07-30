import type {
  BaseLayerDefinition,
  CsvColumnMapping,
  ManagedLayerDefinition,
} from "../lib/types";

export type CsvDetectionRule = {
  pattern: string;
  flags?: string;
  score: number;
};

export type CsvDetectionRules = Partial<
  Record<keyof CsvColumnMapping, CsvDetectionRule[]>
>;

export type AppConfig = {
  csvColumnDetection: CsvDetectionRules;
  baseLayers: BaseLayerDefinition[];
  wmsPresets: ManagedLayerDefinition[];
};

/**
 * Built-in configuration keeps the application usable when the external JSON
 * file is absent or malformed. The file in public/ is loaded over this value.
 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  csvColumnDetection: {
    latitude: [
      {pattern: "^(latitude|lat|y)$", flags: "i", score: 1000},
      {
        pattern: "(^|[^a-z0-9])(latitude|lat)([^a-z0-9]|$)",
        flags: "i",
        score: 800,
      },
    ],
    longitude: [
      {pattern: "^(longitude|lon|lng|x)$", flags: "i", score: 1000},
      {
        pattern: "(^|[^a-z0-9])(longitude|lon|lng)([^a-z0-9]|$)",
        flags: "i",
        score: 800,
      },
    ],
    time: [
      {
        pattern: "^(timestamp|datetime|date|time)$",
        flags: "i",
        score: 1000,
      },
      {
        pattern: "(^|[^a-z0-9])(timestamp|datetime|date|time)([^a-z0-9]|$)",
        flags: "i",
        score: 800,
      },
    ],
    semiMajor: [
      {pattern: "^(sma|semimajor|semi[ _-]?major)$", flags: "i", score: 1000},
    ],
    semiMinor: [
      {pattern: "^(smi|semiminor|semi[ _-]?minor)$", flags: "i", score: 1000},
    ],
    tilt: [
      {
        pattern: "^(tilt|bearing|angle|azimuth|heading)$",
        flags: "i",
        score: 1000,
      },
    ],
  },
  baseLayers: [
    {
      id: "osm",
      name: "OpenStreetMap",
      type: "osm",
      attribution: "© OpenStreetMap contributors",
    },
    {
      id: "osm-hot",
      name: "OpenStreetMap Humanitarian",
      type: "xyz",
      url: "https://{a-c}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
      attribution: "© OpenStreetMap contributors, Tiles style by HOT",
      maxZoom: 19,
    },
  ],
  wmsPresets: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateConfig(value: unknown): AppConfig {
  if (!isObject(value)) throw new Error("Configuration must be an object.");
  const merged = {
    ...DEFAULT_APP_CONFIG,
    ...value,
  } as AppConfig;
  if (!isObject(merged.csvColumnDetection)) {
    throw new Error("csvColumnDetection must be an object.");
  }
  for (const rules of Object.values(merged.csvColumnDetection)) {
    if (!Array.isArray(rules)) {
      throw new Error("Every CSV detection role must contain an array.");
    }
    for (const rule of rules) {
      if (
        !isObject(rule) ||
        typeof rule.pattern !== "string" ||
        typeof rule.score !== "number"
      ) {
        throw new Error("CSV detection rules require pattern and score.");
      }
      // Compile during configuration loading so an invalid rule fails clearly.
      new RegExp(rule.pattern, typeof rule.flags === "string" ? rule.flags : "");
    }
  }
  if (!Array.isArray(merged.baseLayers) || !merged.baseLayers.length) {
    throw new Error("At least one base layer is required.");
  }
  if (!Array.isArray(merged.wmsPresets)) {
    throw new Error("wmsPresets must be an array.");
  }
  return merged;
}

/** Loads runtime configuration without requiring a TypeScript rebuild. */
export async function loadAppConfig(
  url = "/leysight.config.json",
): Promise<AppConfig> {
  const response = await fetch(url, {cache: "no-store"});
  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}.`);
  }
  return validateConfig(await response.json());
}
