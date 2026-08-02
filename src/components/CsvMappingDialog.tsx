import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { inferCsvColumnMapping } from "../lib/csvColumnInference";
import type {CsvDetectionRules} from "../config/appConfig";
import type { CsvColumnMapping, TimestampInterpretation } from "../lib/types";
import {formatTimestampPreview, parseTimestamp} from "../lib/timestamps";
import {ModalDialog} from "./ModalDialog";

type CsvMappingDialogProps = {
  files: File[];
  columns: string[];
  detectionRules: CsvDetectionRules;
  onCancel: () => void;
  onConfirm: (mapping: CsvColumnMapping) => void;
};

export function CsvMappingDialog({
  files,
  columns,
  detectionRules,
  onCancel,
  onConfirm,
}: CsvMappingDialogProps) {
  const defaults = useMemo<CsvColumnMapping>(
    () => inferCsvColumnMapping(columns, detectionRules),
    [columns, detectionRules],
  );
  const [mapping, setMapping] = useState(defaults);
  const [timestampSamples, setTimestampSamples] = useState<string[]>([]);
  type ColumnKey = Exclude<keyof CsvColumnMapping, "timestampInterpretation">;
  const fields: Array<[ColumnKey, string, boolean]> = [
    ["latitude", "Latitude column", true],
    ["longitude", "Longitude column", true],
    ["time", "Time column", false],
    ["semiMajor", "Semi-major axis", false],
    ["semiMinor", "Semi-minor axis", false],
    ["tilt", "Ellipse tilt", false],
    ["color", "Initial color field", false],
  ];
  useEffect(() => {
    let active = true;
    if (!mapping.time || !files[0]) {
      setTimestampSamples([]);
      return () => { active = false; };
    }
    Papa.parse<Record<string, string>>(files[0], {
      header: true,
      preview: 8,
      transformHeader: (header) => header.trim(),
      skipEmptyLines: "greedy",
      complete: ({data}) => {
        if (active) setTimestampSamples(data.map((row) => row[mapping.time!] ?? "").slice(0, 5));
      },
    });
    return () => { active = false; };
  }, [files, mapping.time]);
  const timestampInterpretation = mapping.timestampInterpretation ?? "automatic";
  const duplicateCoordinates = Boolean(
    mapping.latitude && mapping.latitude === mapping.longitude,
  );
  const coordinateErrorId = duplicateCoordinates
    ? "csv-coordinate-mapping-error"
    : undefined;
  const mappingInvalid = !mapping.latitude || !mapping.longitude || duplicateCoordinates;
  return (
    <ModalDialog
      titleId="csv-dialog-title"
      descriptionId="csv-dialog-description"
      onDismiss={onCancel}
      initialFocus="[data-initial-focus]"
    >
        <div className="dialog-header">
          <div>
            <span className="eyebrow">LOCAL DATA</span>
            <h2 id="csv-dialog-title">Map CSV columns</h2>
          </div>
          <p>
            {files.length === 1 ? files[0].name : `${files.length} compatible files`}
          </p>
        </div>
        {mapping.time && (
          <div className="timestamp-preview">
            <label>
              <span>Timestamp interpretation</span>
              <select
                value={timestampInterpretation}
                onChange={(event) => setMapping((current) => ({
                  ...current,
                  timestampInterpretation: event.target.value as TimestampInterpretation,
                }))}
              >
                <option value="automatic">ISO / automatic detection</option>
                <option value="iso">ISO 8601</option>
                <option value="unix-seconds">Unix seconds</option>
                <option value="unix-milliseconds">Unix milliseconds</option>
                <option value="unix-microseconds">Unix microseconds</option>
                <option value="unix-nanoseconds">Unix nanoseconds</option>
                <option value="excel-serial">Excel serial date</option>
              </select>
            </label>
            <div>
              <span className="timestamp-preview-title">Parsed preview</span>
              {timestampSamples.length ? timestampSamples.map((sample, index) => (
                <code key={`${index}-${sample}`}>
                  <span>{sample || "(empty)"}</span>
                  <strong>{formatTimestampPreview(parseTimestamp(sample, timestampInterpretation))}</strong>
                </code>
              )) : <code>No sample values found</code>}
            </div>
          </div>
        )}
        <div className="form-grid">
          {fields.map(([key, label, required]) => (
            <label key={key}>
              <span>{label}</span>
              <select
                data-initial-focus={key === "latitude" ? "true" : undefined}
                aria-invalid={duplicateCoordinates && (key === "latitude" || key === "longitude") || undefined}
                aria-describedby={key === "latitude" || key === "longitude" ? coordinateErrorId : undefined}
                value={mapping[key] ?? ""}
                onChange={(event) =>
                  setMapping((current) => ({
                    ...current,
                    [key]: event.target.value || undefined,
                  }))
                }
              >
                {!required && (
                  <option value="">
                    {key === "color" ? "Uniform" : "None"}
                  </option>
                )}
                {columns.map((column) => (
                  <option value={column} key={column}>
                    {column}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {duplicateCoordinates && (
          <p className="dialog-error" id="csv-coordinate-mapping-error" role="alert">
            Latitude and longitude must use different columns.
          </p>
        )}
        <div className="dialog-note" id="csv-dialog-description">
          Files stay in this browser session. Date/time words and common
          coordinate names are detected automatically; every mapping remains
          editable before loading. Longitude must be between −180° and 180°
          and latitude between −90° and 90°; invalid coordinates are skipped,
          never wrapped. Latitudes beyond Web Mercator's ±85.05112878° limit
          are retained but clamped at that limit for display and reported as
          projection-clamped rows.
        </div>
        <div className="dialog-actions">
          <button className="button secondary" onClick={onCancel}>Cancel</button>
          <button
            className="button primary"
            disabled={mappingInvalid}
            onClick={() => onConfirm(mapping)}
          >
            Load data
          </button>
        </div>
    </ModalDialog>
  );
}
