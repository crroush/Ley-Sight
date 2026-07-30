import { GrowableTypedArray } from "../map/growable";
import {
  gradientColor,
  type ColorPalette,
} from "../lib/colorPalettes";
import type { ColorValueMode } from "../lib/colorValueModes";

const DEFAULT_COLOR = 0x3288bdde;
const MISSING_COLOR = 0x64748bdd;
const SAMPLE_SIZE = 256;

export type FieldColorMode = "numeric" | "temporal" | "categorical";

type FieldSampleStats = {
  populated: number;
  numeric: number;
  temporal: number;
  hasLeadingZeroIdentifier: boolean;
};

function analyzeFieldSample(sample: readonly unknown[]): FieldSampleStats {
  let populated = 0;
  let numeric = 0;
  let temporal = 0;
  let hasLeadingZeroIdentifier = false;
  for (const value of sample) {
    const text = value == null ? "" : String(value).trim();
    if (!text) continue;
    populated += 1;
    if (Number.isFinite(Number(text))) {
      numeric += 1;
      if (/^[+-]?0\d+$/.test(text)) hasLeadingZeroIdentifier = true;
    } else if (Number.isFinite(Date.parse(text))) {
      temporal += 1;
    }
  }
  return { populated, numeric, temporal, hasLeadingZeroIdentifier };
}

export function inferFieldColorMode(
  sample: readonly unknown[],
): FieldColorMode {
  const { populated, numeric, temporal, hasLeadingZeroIdentifier } =
    analyzeFieldSample(sample);
  if (hasLeadingZeroIdentifier && numeric / populated >= 0.9) {
    return "categorical";
  }
  if (populated > 0 && numeric / populated >= 0.9) return "numeric";
  if (populated > 0 && temporal / populated >= 0.9) return "temporal";
  return "categorical";
}

export function resolveFieldColorMode(
  requestedMode: ColorValueMode,
  sample: readonly unknown[],
): FieldColorMode {
  if (requestedMode === "categorical") return "categorical";
  if (requestedMode === "auto") return inferFieldColorMode(sample);

  const { populated, numeric, temporal } = analyzeFieldSample(sample);
  if (populated > 0 && numeric / populated >= 0.9) return "numeric";
  if (populated > 0 && temporal / populated >= 0.9) return "temporal";
  return "categorical";
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function categoricalFieldColor(
  value: unknown,
  palette: ColorPalette = "turbo",
): number {
  const text = value == null ? "" : String(value).trim();
  if (!text) return MISSING_COLOR;
  return gradientColor(hashString(text) / 0xffffffff, palette);
}

export function numericFieldColor(
  value: number,
  minimum: number,
  maximum: number,
  palette: ColorPalette = "turbo",
): number {
  if (!Number.isFinite(value)) return MISSING_COLOR;
  const normalized =
    maximum > minimum
      ? Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)))
      : 0.5;
  return gradientColor(normalized, palette);
}

export class FieldColorBuilder {
  private readonly sample: unknown[] = [];
  private mode: "pending" | "numeric" | "temporal" | "categorical" = "pending";
  private numericValues?: GrowableTypedArray<Float64Array>;
  private categoricalColors?: GrowableTypedArray<Uint32Array>;
  private minimum = Infinity;
  private maximum = -Infinity;

  constructor(
    private readonly palette: ColorPalette = "turbo",
    private readonly requestedMode: ColorValueMode = "auto",
  ) {}

  push(value: unknown): void {
    if (this.mode === "pending") {
      this.sample.push(value);
      if (this.sample.length >= SAMPLE_SIZE) this.chooseMode();
      return;
    }
    this.pushResolved(value);
  }

  finish(): Uint32Array<ArrayBuffer> {
    if (this.mode === "pending") this.chooseMode();
    if (this.mode === "categorical") {
      return this.categoricalColors?.view() as Uint32Array<ArrayBuffer>;
    }
    const values = this.numericValues?.view() as Float64Array<ArrayBuffer>;
    const colors = new Uint32Array(values.length);
    if (!Number.isFinite(this.minimum) || !Number.isFinite(this.maximum)) {
      colors.fill(DEFAULT_COLOR);
      return colors;
    }
    for (let index = 0; index < values.length; index += 1) {
      colors[index] = numericFieldColor(
        values[index],
        this.minimum,
        this.maximum,
        this.palette,
      );
    }
    return colors;
  }

  private chooseMode(): void {
    this.mode = resolveFieldColorMode(this.requestedMode, this.sample);
    if (this.mode === "numeric" || this.mode === "temporal") {
      this.numericValues = new GrowableTypedArray(Float64Array);
    } else {
      this.categoricalColors = new GrowableTypedArray(Uint32Array);
    }
    for (const value of this.sample) this.pushResolved(value);
    this.sample.length = 0;
  }

  private pushResolved(value: unknown): void {
    if (this.mode === "categorical") {
      this.categoricalColors!.push(
        categoricalFieldColor(value, this.palette),
      );
      return;
    }
    const text = value == null ? "" : String(value).trim();
    const numeric = text
      ? this.mode === "temporal"
        ? Date.parse(text)
        : Number(text)
      : Number.NaN;
    const resolved = Number.isFinite(numeric) ? numeric : Number.NaN;
    this.numericValues!.push(resolved);
    if (Number.isFinite(resolved)) {
      this.minimum = Math.min(this.minimum, resolved);
      this.maximum = Math.max(this.maximum, resolved);
    }
  }
}
