import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {modifierBoxSelection} from "./selectionInteractions";

function gesture(
  update: Partial<Parameters<typeof modifierBoxSelection>[0]["originalEvent"]>,
) {
  return {
    originalEvent: {
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      button: 0,
      ...update,
    },
  };
}

describe("map selection interaction", () => {
  it("accepts Ctrl-drag and Cmd-drag with the primary button", () => {
    assert.equal(modifierBoxSelection(gesture({ctrlKey: true})), true);
    assert.equal(modifierBoxSelection(gesture({metaKey: true})), true);
  });

  it("rejects unmodified, Shift, Alt, and non-primary drags", () => {
    assert.equal(modifierBoxSelection(gesture({})), false);
    assert.equal(
      modifierBoxSelection(gesture({ctrlKey: true, shiftKey: true})),
      false,
    );
    assert.equal(
      modifierBoxSelection(gesture({ctrlKey: true, altKey: true})),
      false,
    );
    assert.equal(
      modifierBoxSelection(gesture({ctrlKey: true, button: 2})),
      false,
    );
  });
});
