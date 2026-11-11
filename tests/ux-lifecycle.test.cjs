"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../plugins/opencode-plugin-ux-enhancements/gui-experimental.cjs"), "utf8");

function createRuntime(client) {
  const attributes = new Map(), listeners = new Map(), timers = new Map(), cleanups = [];
  let nextTimer = 0;
  const root = {
    getAttribute: key => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
  };
  const add = (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(callback);
  };
  const remove = (type, callback) => listeners.get(type)?.delete(callback);
  const session = { key: "fixture-session", id: "fixture-session", directory: "/fixture", visit: {}, server: { local: true, client } };
  let open = false;
  const runtime = {
    module: { exports: {} }, Buffer, AbortController,
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    document: { documentElement: root, body: {}, addEventListener: add, removeEventListener: remove, querySelectorAll: () => [] },
    window: { addEventListener: (type, callback) => add(`window:${type}`, callback), removeEventListener: (type, callback) => remove(`window:${type}`, callback) },
    MutationObserver: class { observe() {} disconnect() {} },
    require(name) {
      if (name === "@opencode/plugin/gui") return { Plugin: { define: definition => definition }, Ipc: { define: spec => spec }, Style: {}, createKeyed: (read, setup) => setup(read()) };
      if (name === "effect") return { Schema: { String: {}, Boolean: {}, Struct: value => value } };
      if (name === "solid-js") return {
        createSignal: value => [() => value, next => { value = typeof next === "function" ? next(value) : next; }],
        createEffect: callback => callback(), onCleanup: callback => cleanups.push(callback), getOwner: () => ({}), runWithOwner: (_, callback) => callback(),
      };
      if (name === "solid-js/web") return { render: () => () => {} };
      if (name === "node:path") return path;
      if (name === "node:fs/promises") return {}; // Default main must not perform filesystem operations.
      throw new Error(`Unexpected dependency on normal startup: ${name}`);
    },
  };
  vm.runInNewContext(source, runtime);
  const definition = runtime.module.exports;
  const ctx = {
    sessions: { current: () => session },
    layout: { narrow: () => false, side: { opened: () => open, toggle: () => { open = !open; } } },
    add() {}, t: key => definition.i18n.en[key] || key,
  };
  const flush = async () => {
    await new Promise(resolve => setImmediate(resolve));
    const pending = [...timers.values()]; timers.clear();
    for (const callback of pending) callback();
  };
  return { runtime, definition, ctx, attributes, listeners, cleanups, flush, isOpen: () => open };
}

async function test() {
  const healthyClient = { session: { context: async () => [] }, event: { async *subscribe() {} } };
  const normal = createRuntime(healthyClient);
  let editorProvided = false;
  await normal.definition.main({ provide: () => { editorProvided = true; } });
  assert.equal(editorProvided, true, "Normal main provides save IPC without importing Electron or inspecting files");
  assert.equal(normal.definition.setup({}), undefined, "Incompatible host APIs must be declined before modifying the UI");
  assert.equal(normal.attributes.size, 0);
  const release = normal.definition.setup(normal.ctx);
  assert.equal(normal.listeners.has("desktop-workflow-open-code-test"), false);
  assert.equal(normal.listeners.has("desktop-workflow-open-editor-test"), false);
  release(); normal.cleanups.forEach(cleanup => cleanup());
  await normal.flush();
  assert.equal(normal.attributes.has("data-desktop-workflow"), false);
  assert.equal([...normal.listeners.values()].every(callbacks => callbacks.size === 0), true);

  const unavailable = createRuntime({ session: { context() { throw new Error("Offline host"); } }, event: { async *subscribe() {} } });
  const releaseUnavailable = unavailable.definition.setup(unavailable.ctx);
  await unavailable.flush();
  assert.equal(unavailable.attributes.get("data-desktop-workflow"), "activity-snapshot-unavailable");
  releaseUnavailable(); unavailable.cleanups.forEach(cleanup => cleanup());

  let resolveSnapshot;
  const delayed = createRuntime({
    session: { context: () => new Promise(resolve => { resolveSnapshot = resolve; }) },
    event: { async *subscribe() {
      yield null;
      for (let index = 0; index < 2050; index++) yield { type: "session.tool.called", data: {
        sessionID: "fixture-session", id: `tool-${index}`, name: "read", input: { path: "fixture.md" },
      } };
    } },
  });
  const releaseDelayed = delayed.definition.setup(delayed.ctx);
  await delayed.flush();
  assert.equal(delayed.attributes.get("data-workflow-snapshot"), "live-events-only", "A hung snapshot must not allow an unbounded event buffer");
  resolveSnapshot([]);
  await delayed.flush();
  assert.equal(delayed.attributes.get("data-workflow-snapshot"), "live-events-only", "A late snapshot must not replace newer live state");
  releaseDelayed(); delayed.cleanups.forEach(cleanup => cleanup());

  const mac = createRuntime(healthyClient);
  const releaseMac = mac.definition.setup({ ...mac.ctx, desktop: { os: "macos" } });
  const handlers = mac.listeners.get("window:keydown");
  const press = overrides => {
    const event = { key: "r", ctrlKey: false, metaKey: false, shiftKey: true, altKey: false, isComposing: false, preventDefault() {}, stopImmediatePropagation() {}, composedPath: () => [], ...overrides };
    for (const handler of handlers) handler(event);
  };
  press({ ctrlKey: true }); assert.equal(mac.isOpen(), false);
  press({ metaKey: true }); assert.equal(mac.isOpen(), true);
  press({ metaKey: true }); assert.equal(mac.isOpen(), false);
  releaseMac(); mac.cleanups.forEach(cleanup => cleanup());
  const noIo = { lstat: async () => { throw new Error("Invalid path must not access disk"); } };
  for (const target of ["\\\\host\\share\\file.txt", "C:\\file.txt:stream", "\\\\?\\C:\\file.txt"]) {
    const result = await normal.runtime.saveLocalText({ path: target, original: "", content: "fixture" }, noIo, path.win32);
    assert.equal(result.ok, false);
  }
  console.log("PASS: private-by-default startup, missing host APIs, async failures, event buffer limits, late snapshot protection, lifecycle cleanup, macOS modifier, and network/device/ADS path rejection.");
}

test().catch(error => { console.error(error); process.exitCode = 1; });
