import { useMemo, useState } from "react";
import { inferCsvColumnMapping } from "../lib/csvColumnInference";
import type {CsvDetectionRules} from "../config/appConfig";
import type { CsvColumnMapping } from "../lib/types";

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
  const fields: Array<[keyof CsvColumnMapping, string, boolean]> = [
    ["latitude", "Latitude column", true],
    ["longitude", "Longitude column", true],
    ["time", "Time column", false],
    ["semiMajor", "Semi-major axis", false],
    ["semiMinor", "Semi-minor axis", false],
    ["tilt", "Ellipse tilt", false],
    ["color", "Initial color field", false],
  ];
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="csv-dialog-title">
        <div className="dialog-header">
          <div>
            <span className="eyebrow">LOCAL DATA</span>
            <h2 id="csv-dialog-title">Map CSV columns</h2>
          </div>
          <p>
            {files.length === 1 ? files[0].name : `${files.length} compatible files`}
          </p>
        </div>
        <div className="form-grid">
          {fields.map(([key, label, required]) => (
            <label key={key}>
              <span>{label}</span>
              <select
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
        <div className="dialog-note">
          Files stay in this browser session. Date/time words and common
          coordinate names are detected automatically; every mapping remains
          editable before loading.
        </div>
        <div className="dialog-actions">
          <button className="button secondary" onClick={onCancel}>Cancel</button>
          <button
            className="button primary"
            disabled={!mapping.latitude || !mapping.longitude}
            onClick={() => onConfirm(mapping)}
          >
            Load data
          </button>
        </div>
      </div>
    </div>
  );
}
