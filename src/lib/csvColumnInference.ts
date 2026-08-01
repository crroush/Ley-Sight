import {
  DEFAULT_APP_CONFIG,
  type CsvDetectionRule,
  type CsvDetectionRules,
} from "../config/appConfig";
import type {CsvColumnMapping} from "./types";

function searchableColumnName(column: string): string {
  return column
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/**
 * Returns the highest-scoring configured match. Rules are data, rather than
 * field-name conditionals, so deployments can add naming conventions without
 * rebuilding the application.
 */
export function inferCsvColumn(
  columns: readonly string[],
  rules: readonly CsvDetectionRule[],
): string | undefined {
  let bestColumn: string | undefined;
  let bestScore = -Infinity;
  for (const column of columns) {
    const searchable = searchableColumnName(column);
    for (const rule of rules) {
      let matches = false;
      try {
        matches = new RegExp(rule.pattern, rule.flags ?? "").test(searchable);
      } catch {
        // Invalid external rules are ignored here; loadAppConfig reports them.
        continue;
      }
      if (matches && rule.score > bestScore) {
        bestColumn = column;
        bestScore = rule.score;
      }
    }
  }
  return bestColumn;
}

export function inferCsvColumnMapping(
  columns: readonly string[],
  configuredRules: CsvDetectionRules =
    DEFAULT_APP_CONFIG.csvColumnDetection,
): CsvColumnMapping {
  const detect = (role: keyof CsvColumnMapping): string | undefined =>
    inferCsvColumn(columns, configuredRules[role] ?? []);
  const latitude = detect("latitude") ?? columns[0] ?? "";
  const longitude =
    detect("longitude") ??
    columns.find((column) => column !== latitude) ??
    columns[0] ??
    "";
  const time = detect("time");
  const semiMajor = detect("semiMajor");
  const semiMinor = detect("semiMinor");
  const tilt = detect("tilt");
  const reserved = new Set([
    latitude,
    longitude,
    time,
    semiMajor,
    semiMinor,
    tilt,
  ]);

  return {
    latitude,
    longitude,
    time,
    timestampInterpretation: "automatic",
    semiMajor,
    semiMinor,
    tilt,
    color:
      detect("color") ??
      columns.find((column) => !reserved.has(column)),
  };
}
