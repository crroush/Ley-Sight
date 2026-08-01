import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {MAX_TIMESTAMP_SECONDS, MIN_TIMESTAMP_SECONDS, parseTimestamp} from "./timestamps";

describe("parseTimestamp", () => {
  it("parses ISO timestamps with offsets and treats zone-less values as UTC", () => {
    assert.equal(parseTimestamp("2024-02-29T12:34:56Z", "iso"), 1_709_210_096);
    assert.equal(parseTimestamp("2024-02-29T14:34:56+02:00", "iso"), 1_709_210_096);
    assert.equal(parseTimestamp("2024-02-29 12:34:56", "iso"), 1_709_210_096);
    assert.equal(parseTimestamp("2024-02-29", "iso"), 1_709_164_800);
    assert.ok(Number.isNaN(parseTimestamp("2023-02-29", "iso")));
  });
  it("preserves four-digit ISO years below 100", () => {
    const yearZero = parseTimestamp("0000-01-01T00:00:00Z", "iso");
    const yearNinetyNine = parseTimestamp("0099-12-31T23:59:59.25Z", "iso");
    assert.equal(new Date(yearZero * 1000).toISOString(), "0000-01-01T00:00:00.000Z");
    assert.equal(new Date(yearNinetyNine * 1000).toISOString(), "0099-12-31T23:59:59.250Z");
  });
  it("converts seconds, milliseconds, microseconds, nanoseconds, and Excel dates", () => {
    const expected = 1_700_000_000;
    assert.equal(parseTimestamp("1700000000", "unix-seconds"), expected);
    assert.equal(parseTimestamp("1700000000000", "unix-milliseconds"), expected);
    assert.equal(parseTimestamp("1700000000000000", "unix-microseconds"), expected);
    assert.equal(parseTimestamp("1700000000000000000", "unix-nanoseconds"), expected);
    assert.equal(parseTimestamp("45244.92592592593", "excel-serial"), expected);
  });
  it("rejects empty and invalid values", () => {
    for (const value of ["", "   ", null, undefined, "not a date", "1e9"])
      assert.ok(Number.isNaN(parseTimestamp(value, "automatic")));
  });
  it("supports negative epochs", () => {
    assert.equal(parseTimestamp("-1", "unix-seconds"), -1);
    assert.equal(parseTimestamp("-1000", "unix-milliseconds"), -1);
    assert.equal(parseTimestamp("25568", "excel-serial"), -86_400);
  });
  it("uses deterministic automatic magnitude boundaries", () => {
    assert.equal(parseTimestamp("99999999999"), 99_999_999_999);
    assert.equal(parseTimestamp("100000000000"), 100_000_000);
    assert.equal(parseTimestamp("100000000000000"), 100_000_000);
    assert.equal(parseTimestamp("100000000000000000"), 100_000_000);
  });
  it("validates the supported Date boundaries", () => {
    assert.equal(parseTimestamp(String(MIN_TIMESTAMP_SECONDS), "unix-seconds"), MIN_TIMESTAMP_SECONDS);
    assert.equal(parseTimestamp(String(MAX_TIMESTAMP_SECONDS), "unix-seconds"), MAX_TIMESTAMP_SECONDS);
    assert.ok(Number.isNaN(parseTimestamp(String(MIN_TIMESTAMP_SECONDS - 1), "unix-seconds")));
    assert.ok(Number.isNaN(parseTimestamp(String(MAX_TIMESTAMP_SECONDS + 1), "unix-seconds")));
  });
});
