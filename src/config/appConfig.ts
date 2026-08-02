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

const CSV_ROLES = [
  "latitude",
  "longitude",
  "time",
  "semiMajor",
  "semiMinor",
  "tilt",
  "color",
] as const satisfies readonly (keyof CsvColumnMapping)[];

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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "unknown property");
  }
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path);
}

function requiredUrl(value: unknown, path: string): string {
  const url = requiredString(value, path);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(path, "must be a valid absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(path, "must use http or https");
  }
  return url;
}

function validateCsvRules(value: unknown, path: string): CsvDetectionRules {
  if (!isObject(value)) fail(path, "must be an object");
  rejectUnknownKeys(value, CSV_ROLES, path);
  const validated: CsvDetectionRules = {};
  for (const [role, rules] of Object.entries(value)) {
    const rolePath = `${path}.${role}`;
    if (!Array.isArray(rules)) fail(rolePath, "must be an array");
    validated[role as (typeof CSV_ROLES)[number]] = rules.map((rule, index) => {
      const rulePath = `${rolePath}[${index}]`;
      if (!isObject(rule)) fail(rulePath, "must be an object");
      rejectUnknownKeys(rule, ["pattern", "flags", "score"], rulePath);
      const pattern = requiredString(rule.pattern, `${rulePath}.pattern`);
      if (rule.flags !== undefined && typeof rule.flags !== "string") {
        fail(`${rulePath}.flags`, "must be a string");
      }
      if (typeof rule.score !== "number" || !Number.isFinite(rule.score)) {
        fail(`${rulePath}.score`, "must be a finite number");
      }
      try {
        new RegExp(pattern, rule.flags);
      } catch (error) {
        fail(
          rule.flags === undefined ? `${rulePath}.pattern` : `${rulePath}.flags`,
          `invalid regular expression (${error instanceof Error ? error.message : "unknown error"})`,
        );
      }
      return {pattern, ...(rule.flags === undefined ? {} : {flags: rule.flags}), score: rule.score};
    });
  }
  return validated;
}

function validateBaseLayers(value: unknown, path: string): BaseLayerDefinition[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, "must contain at least one layer");
  }
  const ids = new Set<string>();
  return value.map((layer, index) => {
    const layerPath = `${path}[${index}]`;
    if (!isObject(layer)) fail(layerPath, "must be an object");
    rejectUnknownKeys(layer, ["id", "name", "type", "url", "attribution", "maxZoom"], layerPath);
    const id = requiredString(layer.id, `${layerPath}.id`);
    if (ids.has(id)) fail(`${layerPath}.id`, `duplicate id ${JSON.stringify(id)}`);
    ids.add(id);
    const name = requiredString(layer.name, `${layerPath}.name`);
    if (layer.type !== "osm" && layer.type !== "xyz") {
      fail(`${layerPath}.type`, 'must be "osm" or "xyz"');
    }
    if (layer.type === "osm" && layer.url !== undefined) {
      fail(`${layerPath}.url`, 'is not supported when type is "osm"');
    }
    const url = layer.type === "xyz" ? requiredUrl(layer.url, `${layerPath}.url`) : undefined;
    const attribution = optionalString(layer.attribution, `${layerPath}.attribution`);
    if (layer.maxZoom !== undefined &&
        (typeof layer.maxZoom !== "number" || !Number.isFinite(layer.maxZoom) || layer.maxZoom < 0)) {
      fail(`${layerPath}.maxZoom`, "must be a finite non-negative number");
    }
    return {id, name, type: layer.type, ...(url === undefined ? {} : {url}),
      ...(attribution === undefined ? {} : {attribution}),
      ...(layer.maxZoom === undefined ? {} : {maxZoom: layer.maxZoom})};
  });
}

function validateManagedLayerPresets(value: unknown, path: string): ManagedLayerDefinition[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  const ids = new Set<string>();
  return value.map((layer, index) => {
    const layerPath = `${path}[${index}]`;
    if (!isObject(layer)) fail(layerPath, "must be an object");
    rejectUnknownKeys(layer, ["id", "name", "type", "url", "layers", "attribution", "opacity", "visible"], layerPath);
    const id = requiredString(layer.id, `${layerPath}.id`);
    if (ids.has(id)) fail(`${layerPath}.id`, `duplicate id ${JSON.stringify(id)}`);
    ids.add(id);
    const name = requiredString(layer.name, `${layerPath}.name`);
    if (layer.type !== "wms" && layer.type !== "xyz") {
      fail(`${layerPath}.type`, 'must be "wms" or "xyz"');
    }
    const url = requiredUrl(layer.url, `${layerPath}.url`);
    let layers: string | undefined;
    if (layer.type === "wms") layers = requiredString(layer.layers, `${layerPath}.layers`);
    else if (layer.layers !== undefined) fail(`${layerPath}.layers`, 'is only supported when type is "wms"');
    const attribution = optionalString(layer.attribution, `${layerPath}.attribution`);
    if (typeof layer.opacity !== "number" || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
      fail(`${layerPath}.opacity`, "must be a finite number between 0 and 1");
    }
    if (typeof layer.visible !== "boolean") fail(`${layerPath}.visible`, "must be a boolean");
    return {id, name, type: layer.type, url, ...(layers === undefined ? {} : {layers}),
      ...(attribution === undefined ? {} : {attribution}), opacity: layer.opacity, visible: layer.visible};
  });
}

/**
 * Validates and merges an external configuration. CSV rule arrays replace the
 * defaults for their individual role; omitted roles retain their defaults.
 * `baseLayers` and `wmsPresets` are whole-list settings, so supplying either
 * list replaces (rather than extends) its built-in default.
 */
export function validateConfig(value: unknown): AppConfig {
  if (!isObject(value)) fail("configuration", "must be an object");
  rejectUnknownKeys(value, ["csvColumnDetection", "baseLayers", "wmsPresets"], "configuration");
  const csvOverrides = value.csvColumnDetection === undefined
    ? {}
    : validateCsvRules(value.csvColumnDetection, "csvColumnDetection");
  const baseLayers = validateBaseLayers(
    value.baseLayers ?? DEFAULT_APP_CONFIG.baseLayers,
    "baseLayers",
  );
  const wmsPresets = validateManagedLayerPresets(
    value.wmsPresets ?? DEFAULT_APP_CONFIG.wmsPresets,
    "wmsPresets",
  );
  const baseLayerIds = new Set(baseLayers.map(({id}) => id));
  for (const [index, preset] of wmsPresets.entries()) {
    if (baseLayerIds.has(preset.id)) {
      fail(`wmsPresets[${index}].id`, `duplicate id ${JSON.stringify(preset.id)}`);
    }
  }
  return {
    csvColumnDetection: validateCsvRules(
      {...DEFAULT_APP_CONFIG.csvColumnDetection, ...csvOverrides},
      "csvColumnDetection",
    ),
    baseLayers,
    wmsPresets,
  };
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
