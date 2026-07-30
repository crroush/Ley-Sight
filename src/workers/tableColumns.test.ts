import assert from "node:assert/strict";
import test from "node:test";
import {TableColumnBuilder, tableColumnValue} from "./tableColumns";

test("repeated text values use dictionary codes", () => {
  const builder = new TableColumnBuilder("Vessel");
  for (const value of ["Alpha", "Beta", "Alpha", ""]) builder.push(value);
  const column = builder.finish();
  assert.equal(column.kind, "category");
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => tableColumnValue(column, index)),
    ["Alpha", "Beta", "Alpha", ""],
  );
  if (column.kind === "category") assert.equal(column.dictionary.length, 3);
});

test("numeric data remains a packed Float64 column", () => {
  const builder = new TableColumnBuilder("Speed");
  for (const value of ["12.5", "", "-4"]) builder.push(value);
  const column = builder.finish();
  assert.equal(column.kind, "number");
  if (column.kind !== "number") return;
  assert.equal(column.values[0], 12.5);
  assert.ok(Number.isNaN(column.values[1]));
  assert.equal(column.values[2], -4);
});

test("late text safely promotes a sampled numeric column", () => {
  const builder = new TableColumnBuilder("Mixed");
  for (let index = 0; index < 1_024; index += 1) {
    builder.push(String(index));
  }
  builder.push("unknown");
  const column = builder.finish();
  assert.equal(column.kind, "category");
  assert.equal(tableColumnValue(column, 1_024), "unknown");
});
