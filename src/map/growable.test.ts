import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GrowableTypedArray } from "./growable";

describe("GrowableTypedArray", () => {
  it("grows without losing values", () => {
    const values = new GrowableTypedArray(Float64Array, 2);
    assert.equal(values.append(Float64Array.from([1.5, 2.5])), 0);
    assert.equal(values.append(Float64Array.from([3.5, 4.5, 5.5])), 2);
    assert.equal(values.length, 5);
    assert.deepEqual([...values.view()], [1.5, 2.5, 3.5, 4.5, 5.5]);
  });

  it("clears logically and reuses capacity", () => {
    const values = new GrowableTypedArray(Uint32Array, 1);
    values.append(Uint32Array.from([1, 2, 3]));
    const capacity = values.capacity;
    values.clear();
    values.push(9);
    assert.equal(values.capacity, capacity);
    assert.deepEqual([...values.view()], [9]);
  });
});
