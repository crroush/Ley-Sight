import assert from "node:assert/strict";
import {afterEach, beforeEach, test} from "node:test";
import {JSDOM} from "jsdom";
import {CsvMappingDialog} from "./CsvMappingDialog";
import {ModalDialog} from "./ModalDialog";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
});
const {cleanup, fireEvent, render, screen} = await import("@testing-library/react");

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  cleanup();
});

test("modal focuses, wraps focus, dismisses on Escape, and restores the opener", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  let dismissed = false;
  const view = render(
    <ModalDialog titleId="title" onDismiss={() => { dismissed = true; }}>
      <h2 id="title">Example dialog</h2>
      <input aria-label="First field" />
      <button>Last action</button>
    </ModalDialog>,
  );

  const first = screen.getByLabelText("First field");
  const last = screen.getByRole("button", {name: "Last action"});
  assert.equal(document.activeElement, first);
  first.focus();
  fireEvent.keyDown(first, {key: "Tab", shiftKey: true});
  assert.equal(document.activeElement, last);
  fireEvent.keyDown(last, {key: "Tab"});
  assert.equal(document.activeElement, first);
  fireEvent.keyDown(first, {key: "Escape"});
  assert.equal(dismissed, true);

  view.unmount();
  assert.equal(document.activeElement, opener);
});

test("CSV mapping exposes labels and rejects duplicate coordinate columns", () => {
  render(
    <CsvMappingDialog
      files={[]}
      columns={["lat", "lon"]}
      detectionRules={{}}
      onCancel={() => undefined}
      onConfirm={() => assert.fail("invalid mapping must not be confirmed")}
    />,
  );

  const latitude = screen.getByLabelText("Latitude column");
  const longitude = screen.getByLabelText("Longitude column");
  assert.equal(document.activeElement, latitude);
  assert.equal(screen.getByRole("dialog").getAttribute("aria-labelledby"), "csv-dialog-title");
  assert.equal(screen.getByRole("dialog").getAttribute("aria-describedby"), "csv-dialog-description");

  fireEvent.change(longitude, {target: {value: "lat"}});
  const error = screen.getByRole("alert");
  assert.match(error.textContent ?? "", /different columns/i);
  assert.equal(latitude.getAttribute("aria-invalid"), "true");
  assert.equal(longitude.getAttribute("aria-describedby"), error.id);
  assert.equal(screen.getByRole("button", {name: "Load data"}).hasAttribute("disabled"), true);
});
