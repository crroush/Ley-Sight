import React from "react";
import assert from "node:assert/strict";
import {afterEach, beforeEach, test} from "node:test";
import {JSDOM} from "jsdom";
import {CsvMappingDialog} from "./CsvMappingDialog";
import {ModalDialog} from "./ModalDialog";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
(globalThis as typeof globalThis & { React: typeof React }).React = React;
Object.defineProperties(globalThis, {
  window: {value: dom.window, configurable: true},
  document: {value: dom.window.document, configurable: true},
  navigator: {value: dom.window.navigator, configurable: true},
  HTMLElement: {value: dom.window.HTMLElement, configurable: true},
  Node: {value: dom.window.Node, configurable: true},
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

test("Shift+Tab wraps from an initially focused non-tabbable heading", () => {
  render(
    <ModalDialog titleId="heading" initialFocus="#heading">
      <h2 id="heading" tabIndex={-1}>Settings</h2>
      <button>First action</button>
      <button>Last action</button>
    </ModalDialog>,
  );

  const heading = screen.getByRole("heading", {name: "Settings"});
  const last = screen.getByRole("button", {name: "Last action"});
  assert.equal(document.activeElement, heading);
  fireEvent.keyDown(heading, {key: "Tab", shiftKey: true});
  assert.equal(document.activeElement, last);
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

test("CSV mapping resets inferred fields when another CSV replaces the open dialog", () => {
  const detectionRules = {
    latitude: [{pattern: "^(lat|y)$", score: 10}],
    longitude: [{pattern: "^(lon|x)$", score: 10}],
    time: [{pattern: "^time$", score: 10}],
  };
  const props = {
    files: [] as File[],
    detectionRules,
    onCancel: () => undefined,
    onConfirm: () => undefined,
  };
  const view = render(
    <CsvMappingDialog {...props} columns={["lat", "lon", "time"]} />,
  );
  assert.equal(screen.getByLabelText<HTMLSelectElement>("Time column").value, "time");

  view.rerender(
    <CsvMappingDialog {...props} columns={["y", "x", "category"]} />,
  );

  assert.equal(screen.getByLabelText<HTMLSelectElement>("Latitude column").value, "y");
  assert.equal(screen.getByLabelText<HTMLSelectElement>("Longitude column").value, "x");
  assert.equal(screen.getByLabelText<HTMLSelectElement>("Time column").value, "");
});
