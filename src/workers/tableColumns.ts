import type {PackedTableColumn} from "../lib/types";
import {GrowableTypedArray} from "../map/growable";

const TYPE_SAMPLE_SIZE = 1_024;

function numericValue(value: string): number {
  if (!value.trim()) return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Builds one compact table column while CSV rows stream through the data
 * worker. Numeric data stays numeric; text is represented by 32-bit dictionary
 * codes so repeated values such as vessel names are stored only once.
 */
export class TableColumnBuilder {
  private readonly name: string;
  private mode: "pending" | "number" | "category" = "pending";
  private pending: string[] = [];
  private numbers = new GrowableTypedArray(Float64Array);
  private codes = new GrowableTypedArray(Uint32Array);
  private dictionary = [""];
  private dictionaryCodes = new Map<string, number>([["", 0]]);

  constructor(name: string) {
    this.name = name;
  }

  push(rawValue: unknown): void {
    const value = rawValue == null ? "" : String(rawValue);
    if (this.mode === "pending") {
      this.pending.push(value);
      if (this.pending.length >= TYPE_SAMPLE_SIZE) this.commitPending();
      return;
    }
    if (this.mode === "number") {
      const parsed = numericValue(value);
      if (value.trim() && !Number.isFinite(parsed)) {
        this.convertNumbersToCategories();
        this.pushCategory(value);
      } else {
        this.numbers.push(parsed);
      }
      return;
    }
    this.pushCategory(value);
  }

  finish(): PackedTableColumn {
    if (this.mode === "pending") this.commitPending();
    if (this.mode === "number") {
      return {
        kind: "number",
        name: this.name,
        values: this.numbers.snapshot() as Float64Array<ArrayBuffer>,
      };
    }
    return {
      kind: "category",
      name: this.name,
      codes: this.codes.snapshot() as Uint32Array<ArrayBuffer>,
      dictionary: this.dictionary,
    };
  }

  private commitPending(): void {
    const numeric = this.pending.every(
      (value) => !value.trim() || Number.isFinite(numericValue(value)),
    );
    this.mode = numeric ? "number" : "category";
    const values = this.pending;
    this.pending = [];
    for (const value of values) {
      if (this.mode === "number") {
        this.numbers.push(numericValue(value));
      } else {
        this.pushCategory(value);
      }
    }
  }

  private convertNumbersToCategories(): void {
    this.mode = "category";
    for (let index = 0; index < this.numbers.length; index += 1) {
      const value = this.numbers.get(index);
      this.pushCategory(Number.isFinite(value) ? String(value) : "");
    }
    this.numbers = new GrowableTypedArray(Float64Array, 1);
  }

  private pushCategory(value: string): void {
    let code = this.dictionaryCodes.get(value);
    if (code == null) {
      code = this.dictionary.length;
      this.dictionary.push(value);
      this.dictionaryCodes.set(value, code);
    }
    this.codes.push(code);
  }
}

export function tableColumnTransferList(
  columns: readonly PackedTableColumn[],
): Transferable[] {
  return columns.map((column) =>
    column.kind === "number" ? column.values.buffer : column.codes.buffer,
  );
}

export function tableColumnValue(
  column: PackedTableColumn,
  index: number,
): string | number {
  if (column.kind === "number") return column.values[index];
  return column.dictionary[column.codes[index]] ?? "";
}
