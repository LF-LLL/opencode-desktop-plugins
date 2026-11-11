"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).name,
  "opencode-plugin-ux-enhancements");

const contributions = [], cleanups = [];
const listeners = new Map();
function addListener(type, callback) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(callback);
}
function removeListener(type, callback) {
  listeners.get(type)?.delete(callback);
  if (listeners.get(type)?.size === 0) listeners.delete(type);
}
const attributes = new Map();
const root = {
  getAttribute: key => attributes.get(key) ?? null,
  setAttribute: (key, value) => attributes.set(key, value),
  removeAttribute: key => attributes.delete(key),
};
const rowAttributes = new Set(["data-pane-row"]);
const row = { hasAttribute: key => rowAttributes.has(key), setAttribute: key => rowAttributes.add(key), removeAttribute: key => rowAttributes.delete(key) };
const chat = { parentElement: row, getClientRects: () => [{}] };
const document = {
  documentElement: root, body: {},
  addEventListener: addListener, removeEventListener: removeListener,
  querySelectorAll: selector => selector === '[data-slot="session-chat-panel"]' ? [chat] : [],
  createElement() {
    return { dataset: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} };
  },
};
let disconnected = false;
const sandbox = {
  module: { exports: {} }, document, AbortController, setTimeout, clearTimeout, Buffer,
  window: { addEventListener: (type, callback) => addListener(`window:${type}`, callback), removeEventListener: (type, callback) => removeListener(`window:${type}`, callback) },
  MutationObserver: class { observe() {} disconnect() { disconnected = true; } },
  require(name) {
    if (name === "@opencode/plugin/gui") return {
      Plugin: { define: value => value }, Ipc: { define: value => value }, Style: "style", Command: "command", Slot: "slot",
      createKeyed: (read, fn) => fn(read()),
    };
    if (name === "solid-js") return {
      getOwner: () => ({}), runWithOwner: (_, fn) => fn(),
      createSignal(value) { return [() => value, next => { value = typeof next === "function" ? next(value) : next; }]; },
      createEffect(fn) { fn(); }, onCleanup(fn) { cleanups.push(fn); },
    };
    if (name === "solid-js/web") return { render: () => () => {} };
    if (name === "effect") return { Schema: { Struct: value => value, String: {}, Boolean: {} } };
    throw new Error(name);
  },
};
const guiSource = fs.readFileSync(path.join(__dirname, "gui-experimental.cjs"), "utf8");
assert.ok(!guiSource.includes("模型思考 · 优先中文"), "Do not add a repetitive language disclaimer under model reasoning");
vm.runInNewContext(guiSource, sandbox);
const { fileCandidates, resolveReference, toolSummary, snapshotTools, applyToolEvent } = sandbox;
const normalize = value => JSON.parse(JSON.stringify(value));

assert.deepEqual(normalize(fileCandidates("Read C:\\Users\\Dev Name\\git\\README.md:12 and ./src/index.ts and `package.json`.")), ["C:/Users/Dev Name/git/README.md", "./src/index.ts", "package.json"]);
assert.deepEqual(normalize(fileCandidates("file:///C:/Users/Dev%20Name/readme.md:4:2")), ["C:/Users/Dev Name/readme.md"]);
assert.deepEqual(normalize(fileCandidates("...\\engine\\LlmClient.java:187-198")), ["engine/LlmClient.java"]);
assert.deepEqual(normalize(fileCandidates("...\\observability\\TraceRecorder.java:52-63,66-100")), ["observability/TraceRecorder.java"]);
assert.deepEqual(normalize(fileCandidates("https://example.com/file.md *.md tools/*.py -flag node:fs")), []);
assert.equal(resolveReference("../notes.md", "C:\\work\\project"), "C:/work/notes.md");
assert.equal(resolveReference("./src/file.ts", "C:/work/project"), "C:/work/project/src/file.ts");
assert.equal(resolveReference("C:/outside/a.md", "C:/work"), "C:/outside/a.md");
assert.equal(sandbox.getDiagnosticDirectory("C:\\Users\\Tester\\AppData\\Local", "/tmp", 1000, path.win32), "C:\\Users\\Tester\\AppData\\Local\\Temp\\opencode");
assert.equal(sandbox.getDiagnosticDirectory(undefined, "/tmp", 1000, path.posix), "/tmp/opencode-1000");
assert.equal(sandbox.getDiagnosticDirectory(undefined, "/tmp", undefined, path.posix), "/tmp/opencode-user");
assert.equal(fileCandidates(Array.from({ length: 80 }, (_, i) => `a${i}.md`).join(" ")).length, 24);
assert.equal(toolSummary({ name: "shell", state: { status: "completed", input: { command: "node test.cjs" }, metadata: { exit: 1 } } }).status, "error");
for (const command of ["curl -H 'Authorization: Bearer fixture-value'", "curl https://fixture-user:fixture-pass@example.com/", "tool --token fixture-value", 'tool api_key="fixture-value"']) {
  const summary = toolSummary({ name: "shell", state: { status: "running", input: { command } } }).text;
  assert.equal(summary.includes("fixture-value"), false, "Added summaries must redact common credential forms");
  assert.equal(summary.includes("fixture-pass"), false);
}
assert.match(toolSummary({ name: "shell", state: { status: "running", input: { command: "@'\nconsole.log('test')\n'@ | node -" } } }).text, /Running.*Run script \(3 lines\).*console/);
assert.equal(toolSummary({ name: "execute", state: { status: "running", input: {}, metadata: { toolCalls: [{ tool: "browser.evaluate", status: "running", input: { path: "README.md" } }] } } }).text, "Running · Run tools · browser.evaluate");
assert.equal(toolSummary({ name: "read", state: { status: "completed", input: { path: "C:/work/package.json" } } }).text, "Completed · Read file");
function translator(locale) {
  return (key, params = {}) => (sandbox.module.exports.i18n[locale]?.[key] || sandbox.module.exports.i18n.en[key] || key)
    .replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}
const webpage = { name: "webfetch", state: { status: "completed", input: { url: "https://example.com/" } } };
assert.equal(toolSummary(webpage, translator("en")).text, "Completed · Read webpage · https://example.com/");
assert.equal(toolSummary(webpage, translator("zh")).text, "已完成 · 读取网页 · https://example.com/");
assert.equal(toolSummary({ ...webpage, state: { ...webpage.state, status: "error" } }, translator("en")).text, "Failed · Read webpage · https://example.com/");
assert.equal(toolSummary(webpage, translator("de")).text, toolSummary(webpage).text, "Missing locales fall back to English");
assert.equal(toolSummary({ name: "custom", state: { status: "custom-status" } }).text, "custom-status · custom");
assert.doesNotThrow(() => applyToolEvent(new Map(), null));
assert.doesNotThrow(() => applyToolEvent(new Map(), { type: "session.tool.progress" }));
assert.equal(snapshotTools({ data: [] }).size, 0, "Malformed host snapshots must fail closed");
assert.equal(snapshotTools([null, { content: {} }]).size, 0);
for (const [key, value] of Object.entries(sandbox.module.exports.i18n.en)) {
  assert.ok(!/\p{Script=Han}/u.test(value), `English UI translation must not contain Chinese: ${key}`);
  assert.ok(key in sandbox.module.exports.i18n.zh, `Chinese translation is present: ${key}`);
  assert.deepEqual(value.match(/\{\w+\}/g), sandbox.module.exports.i18n.zh[key].match(/\{\w+\}/g), `Translation parameters match: ${key}`);
}
assert.match(sandbox.translatedText(translator("en"), "文件已被外部修改，未覆盖；编辑内容已保留"), /changed externally/);
assert.equal(translator("en")("copied", { label: translator("en")("copyPath") }), "Copy path (copied)");
assert.ok(!guiSource.includes('row.appendChild(document.createTextNode("文件："))'), "No extra file reference rows in the activity area");
const seenGroups = new Set();
let groupExpanded = "false", groupClicks = 0, groupIds = "first,second";
const groupTrigger = { getAttribute: () => groupExpanded, click() { groupClicks++; groupExpanded = "true"; } };
const group = { getAttribute: () => groupIds, querySelector: () => groupTrigger };
assert.equal(sandbox.defaultExpandToolGroup(group, seenGroups, "session-a"), true);
assert.equal(groupExpanded, "true");
groupExpanded = "false"; groupIds += ",third";
assert.equal(sandbox.defaultExpandToolGroup(group, seenGroups, "session-a"), false, "Respect manual collapse as tools stream");
assert.equal(sandbox.defaultExpandToolGroup({ ...group }, seenGroups, "session-a"), false, "Respect manual collapse after virtualized remount");
assert.equal(groupClicks, 1);
assert.equal(sandbox.defaultExpandToolGroup(group, seenGroups, "session-b"), true, "A different session has its own defaults");
assert.equal(sandbox.defaultExpandToolGroup({ getAttribute: () => "ready", querySelector: () => null }, seenGroups, "session-a"), false, "Wait until the native trigger is mounted");
const collapsedGroups = new Set();
const completedTools = new Map([['first', { state: { status: 'completed' } }], ['second', { state: { status: 'running' } }]]);
groupIds = 'first,second'; groupExpanded = 'true';
const collapseTrigger = { getAttribute: () => groupExpanded, click() { groupExpanded = groupExpanded === 'true' ? 'false' : 'true'; } };
const completedGroup = { getAttribute: () => groupIds, querySelector: () => collapseTrigger };
assert.equal(sandbox.collapseCompletedToolGroup(completedGroup, collapsedGroups, completedTools, 's', true, false), false);
completedTools.get('second').state.status = 'completed';
assert.equal(sandbox.collapseCompletedToolGroup(completedGroup, collapsedGroups, completedTools, 's', false, false), false);
assert.equal(sandbox.collapseCompletedToolGroup(completedGroup, collapsedGroups, completedTools, 's', true, false), true);
assert.equal(groupExpanded, 'false', 'Collapse completed tools after an answer appears');
groupExpanded = 'true';
assert.equal(sandbox.collapseCompletedToolGroup(completedGroup, collapsedGroups, completedTools, 's', true, false), false,
  'A manual reopen after auto-collapse must survive later scans');
assert.equal(sandbox.collapseCompletedToolGroup(completedGroup, new Set(), completedTools, 's', false, true), true,
  'Collapse completed tools when execution finishes without another answer');
assert.equal(toolSummary({ name: "execute", state: { status: "completed", input: {}, metadata: { toolCalls: [{ tool: "search", status: "error" }] } } }).status, "error");
assert.doesNotThrow(() => toolSummary({ name: "execute", state: { status: "streaming", input: "null", metadata: { toolCalls: [null, 1] } } }));
const tools = snapshotTools([{ type: "assistant", content: [{ type: "tool", id: "t1", name: "read", state: { status: "completed", input: { path: "README.md" } } }] }]);
assert.equal(tools.get("t1").name, "read");
const outputSnapshot = snapshotTools([{ content: [{ type: "tool", id: "private-output", name: "read", state: {
  status: "completed", input: { path: "example.txt" }, output: "Do not retain file contents", metadata: { exit: 0 },
} }] }]);
assert.equal(outputSnapshot.get("private-output").state.output, undefined, "Presentation state must not retain tool output");
for (const event of [
  { type: "session.tool.input.started", data: { id: "t2", name: "shell" } },
  { type: "session.tool.input.delta", data: { id: "t2", delta: '{"command":' } },
  { type: "session.tool.input.ended", data: { id: "t2", text: '{"command":"node test.cjs"}' } },
  { type: "session.tool.called", data: { id: "t2", input: { command: "node test.cjs" } } },
  { type: "session.tool.progress", data: { id: "t2", metadata: { exit: 0 } } },
  { type: "session.tool.success", data: { id: "t2", metadata: { exit: 0 } } },
]) applyToolEvent(tools, event);
assert.match(toolSummary(tools.get("t2")).text, /Completed.*node test.cjs/);

// Existing labels become links in place. No wrapper, duplicate row, or text replacement.
const inlineSession = { key: "inline-session", directory: "C:/work" };
let inlineCurrent = inlineSession, openedLink;
const inlineAttributes = new Map([["title", "original title"]]), inlineHandlers = new Map();
const inlineLabel = {
  textContent: "package.json limit=200", childNodes: ["unchanged"],
  getAttribute: name => inlineAttributes.get(name) ?? null,
  setAttribute: (name, value) => inlineAttributes.set(name, value), removeAttribute: name => inlineAttributes.delete(name),
  addEventListener: (type, fn) => inlineHandlers.set(type, fn), removeEventListener: type => inlineHandlers.delete(type),
};
const inlineChildren = inlineLabel.childNodes;
const restoreInline = sandbox.installInlineFileLink(inlineLabel, "C:/work/package.json", inlineSession, {
  sessions: { current: () => inlineCurrent }, links: { open: link => { openedLink = link; } },
});
assert.equal(inlineLabel.textContent, "package.json limit=200");
assert.equal(inlineLabel.childNodes, inlineChildren);
assert.equal(inlineAttributes.get("role"), "link");
const inlineEvent = { type: "click", button: 0, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
inlineHandlers.get("click")(inlineEvent);
assert.equal(openedLink.href, "C:/work/package.json"); assert.equal(openedLink.exact, true);
assert.ok(inlineEvent.prevented && inlineEvent.stopped, "File clicks must not toggle the surrounding group");
openedLink = undefined; inlineHandlers.get("keydown")({ ...inlineEvent, type: "keydown", key: "Enter" });
assert.equal(openedLink.href, "C:/work/package.json");
openedLink = undefined; inlineCurrent = { key: "another-session" }; inlineHandlers.get("click")(inlineEvent);
assert.equal(openedLink, undefined, "Never open a stale-session link");
inlineLabel.setAttribute("tabindex", "2"); restoreInline();
assert.equal(inlineAttributes.get("title"), "original title");
assert.equal(inlineAttributes.get("tabindex"), "2", "Cleanup must not overwrite a later host update");
assert.equal(inlineAttributes.has("role"), false); assert.equal(inlineHandlers.size, 0);
const codeLabel = text => ({ textContent: text, closest: () => null, getAttribute: () => null, matches: () => false });
assert.equal(sandbox.inlineFileTarget(codeLabel("C:\\work\\package.json:12"), tools, inlineSession), "C:/work/package.json");
assert.equal(sandbox.inlineFileTarget(codeLabel("...\\engine\\LlmClient.java:187-198"), tools, inlineSession), "C:/work/engine/LlmClient.java");
const treeFileRow = pathValue => ({ getAttribute: name => name === "data-item-path" ? pathValue : null });
assert.equal(sandbox.resolveTreeFileSuffix("engine/LlmClient.java", {
  querySelectorAll: () => [treeFileRow("src/main/java/engine/LlmClient.java")],
}), "src/main/java/engine/LlmClient.java", "Resolve shortened references to a unique visible tree file");
assert.equal(sandbox.resolveTreeFileSuffix("engine/LlmClient.java", {
  querySelectorAll: () => [treeFileRow("src/one/engine/LlmClient.java"), treeFileRow("src/two/engine/LlmClient.java")],
}), null, "Do not guess when a shortened path is ambiguous");
const originalQuerySelectorAll = document.querySelectorAll;
document.querySelectorAll = selector => selector.includes("session-review-v2-sidebar-tree")
  ? [treeFileRow("src/main/java/engine/LlmClient.java")] : originalQuerySelectorAll(selector);
assert.equal(sandbox.inlineFileTarget(codeLabel("...\\engine\\LlmClient.java:187-198"), tools, inlineSession),
  "C:/work/src/main/java/engine/LlmClient.java", "Open the unique full path represented by a shortened summary reference");
document.querySelectorAll = originalQuerySelectorAll;
document.querySelectorAll = selector => selector.includes("session-review-v2-sidebar-tree")
  ? [treeFileRow("src/one/engine/LlmClient.java"), treeFileRow("src/two/engine/LlmClient.java")]
  : originalQuerySelectorAll(selector);
assert.equal(sandbox.inlineFileTarget(codeLabel("...\\engine\\LlmClient.java:187-198"), tools, inlineSession), undefined,
  "Do not create a misleading link for an ambiguous shortened path");
document.querySelectorAll = originalQuerySelectorAll;
assert.equal(sandbox.inlineFileTarget(codeLabel("node test.cjs"), tools, inlineSession), undefined);
assert.equal(sandbox.inlineFileTarget(codeLabel("https://example.com/test.md"), tools, inlineSession), undefined);
assert.equal(sandbox.inlineFileTarget({ ...codeLabel("test.cjs"), closest: () => ({}) }, tools, inlineSession), undefined, "Inline-code linking leaves fenced blocks to the dedicated detector");
const fencedText = "C:\\work\\one.md\r\nC:\\work\\two.cjs\r\n";
const fencedCode = { textContent: fencedText, className: "language-plaintext", getAttribute: name => name === "class" ? "language-plaintext" : null };
const fencedPre = { querySelector: selector => selector === "code" ? fencedCode : null };
fencedCode.closest = selector => selector === "pre" ? fencedPre : null;
const fencedEntries = sandbox.fencedFileList(fencedCode);
assert.deepEqual(normalize(fencedEntries.filter(entry => entry.path).map(entry => entry.path)), ["C:/work/one.md", "C:/work/two.cjs"]);
assert.equal(sandbox.fencedFileList({ ...fencedCode, textContent: "node test.cjs\nC:\\work\\one.md\n" }), undefined, "Mixed command blocks stay untouched");
assert.equal(sandbox.fencedFileList({ ...fencedCode, textContent: "C:\\work\\one.md\n" }), undefined, "A lone path is not treated as a file list");
assert.equal(sandbox.fencedFileList({ ...fencedCode, className: "language-javascript" }), undefined, "Source-code fences stay untouched");
assert.equal(sandbox.fencedFileList({ ...fencedCode, textContent: "README.md\npackage.json\n" }), undefined, "Relative references stay untouched");

function mockText(value) {
  return { nodeType: 3, nodeValue: value, parentNode: null, get textContent() { return this.nodeValue; } };
}
function mockElement(tag) {
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), childNodes: [], attributes: new Map(), listeners: new Map(),
    isConnected: true, parentNode: null,
    get textContent() { return this.childNodes.map(child => child.textContent).join(""); },
    set textContent(value) { this.replaceChildren(mockText(String(value))); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    removeEventListener(name) { this.listeners.delete(name); },
    appendChild(child) {
      if (child.nodeType === 11) {
        for (const entry of [...child.childNodes]) this.appendChild(entry);
        child.childNodes.length = 0;
        return child;
      }
      child.parentNode = this; this.childNodes.push(child); return child;
    },
    replaceChildren(...children) {
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes = [];
      children.forEach(child => this.appendChild(child));
    },
  };
  return node;
}
const savedCreateElement = document.createElement;
document.createElement = tag => mockElement(tag);
document.createTextNode = text => mockText(text);
document.createDocumentFragment = () => ({ nodeType: 11, childNodes: [], appendChild(child) { child.parentNode = this; this.childNodes.push(child); } });
const fencedNode = mockElement("code"), originalFenceText = mockText(fencedText);
fencedNode.appendChild(originalFenceText);
const fencedOpened = [], fencedCurrent = { key: "fenced-session", directory: "C:/work" };
const installedFence = sandbox.installFencedFileLinks(fencedNode, fencedEntries, [true, false], fencedCurrent, {
  sessions: { current: () => fencedCurrent }, links: { open: link => fencedOpened.push(link) },
});
assert.equal(fencedNode.textContent, fencedText, "Linkifying paths must preserve code text and line breaks");
const fencedAnchor = fencedNode.childNodes.find(node => node.tagName === "A");
assert.ok(fencedAnchor, "Existing path lines become links inside a pure file-list fence");
fencedAnchor.listeners.get("click")({ type: "click", button: 0, preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(fencedOpened[0].href, "C:/work/one.md");
installedFence.dispose();
assert.deepEqual(fencedNode.childNodes, [originalFenceText], "Cleanup restores the original code children");
delete document.createTextNode;
delete document.createDocumentFragment;
document.createElement = savedCreateElement;
const readLabel = { ...codeLabel("README.md limit=200"), matches: () => true, closest: selector => selector === '[data-timeline-part-id]' ? { getAttribute: () => "t1" } : null };
assert.equal(sandbox.inlineFileTarget(readLabel, tools, inlineSession), "C:/work/README.md", "Resolve grouped filenames from the exact owning tool, not their display text");

let open = false, narrow = false;
const session = { key: "server\nsession", id: "session", directory: "C:/work", visit: {}, server: { client: {
  event: { async *subscribe() {} }, session: { context: async () => ({ data: [] }) },
} } };
const definition = sandbox.module.exports;
let openedCodeTest;
const cleanup = definition.setup({
  options: { developerChecks: true },
  sessions: { current: () => session },
  layout: { narrow: () => narrow, side: { opened: () => open, toggle: () => { open = !open; }, resize() { throw new Error("Stored width must not change"); } } },
  links: { exists: async () => true, open: link => { openedCodeTest = link.href; } },
  t: key => definition.i18n.zh[key],
  add: (type, value) => contributions.push({ type, value: typeof value === "function" ? value() : value }),
});
Array.from(listeners.get("desktop-workflow-open-code-test") || [])[0]({ detail: "/tmp/desktop-workflow/test.cjs" });
assert.equal(openedCodeTest, "/tmp/desktop-workflow/test.cjs", "Runtime test links must use the path supplied by the plugin package");
assert.ok(!contributions.some(item => item.type === "command"), "No extra shortcut command");
const keyHandler = Array.from(listeners.get("window:keydown"))[0];
const pressReviewKey = (overrides = {}) => {
  const event = { key: "r", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, ...overrides, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
  keyHandler(event);
  return event.prevented;
};
const styling = contributions.find(item => item.type === "style").value;
assert.ok(styling.includes('[data-workflow-activity] { display: block; }'), "Status stays below the native row, not in side-by-side columns");
assert.ok(styling.includes('[data-pane-row][data-workflow-focus] [data-slot="artifact-markdown-page"] { padding-inline: clamp(12px, 6.25%, 67px); }'));
assert.ok(styling.includes('[data-pane-row][data-workflow-focus] [data-slot="artifact-markdown-content"] { max-width: calc(50cqw + 384px); }'));
assert.ok(pressReviewKey()); assert.ok(row.hasAttribute("data-workflow-focus"));
pressReviewKey(); assert.ok(!row.hasAttribute("data-workflow-focus")); assert.equal(open, false, "Second press hides the side panel");
open = true; pressReviewKey(); assert.equal(open, false, "An already visible split panel also closes");
open = false; pressReviewKey(); assert.equal(open, true); assert.ok(row.hasAttribute("data-workflow-focus"));
pressReviewKey(); assert.equal(open, false); narrow = true; assert.equal(pressReviewKey(), false);
assert.equal(pressReviewKey({ key: "f", shiftKey: false, altKey: true }), false);
assert.ok(!contributions.some(item => item.type === "slot"), "No separate full-width button");
assert.equal(Array.from(listeners.values()).reduce((total, callbacks) => total + callbacks.size, 0), 8);
const reviewButton = { tagName: "BUTTON", closest: () => ({}) };
let blockedReviewClick = false;
narrow = false;
for (const callback of listeners.get("click")) callback({
  button: 0, composedPath: () => [reviewButton], preventDefault() {}, stopImmediatePropagation() { blockedReviewClick = true; },
});
assert.ok(blockedReviewClick);
assert.ok(row.hasAttribute("data-workflow-focus"));
assert.equal(open, true);
cleanup(); for (const fn of cleanups) fn();
assert.equal(listeners.size, 0, "Read-only preview listeners must be removed on cleanup");
assert.ok(disconnected); assert.equal(root.getAttribute("data-desktop-workflow"), null);
assert.ok(!row.hasAttribute("data-workflow-focus"));

let tabKey = "file://src/test.py";
const fileDoc = { getElementById: () => ({ getAttribute: () => tabKey }) };
const fileCtx = {
  sessions: { current: () => session },
  screen: { current: () => ({ file: {
    resolve: key => key.slice("file://".length),
    get: () => ({ content: { type: "text", content: "print('test')\r\n" } }),
  } }) },
};
const treeRows = new Map();
const tree = { querySelectorAll: () => Array.from(treeRows.values()) };
const review = { querySelector: selector => selector === '[data-slot="session-review-v2-sidebar-tree"]' ? tree : null };
const treeViewer = { closest: selector => selector === '[data-component="session-review-v2"]' ? review : null };
let fileScrolled = 0;
let fileClicked = 0;
const makeTreeRow = (filePath, type, expanded) => {
  let selected = false;
  return {
    getAttribute: name => ({ "data-item-path": filePath, "data-item-type": type, "aria-expanded": expanded,
      "data-item-selected": selected ? "true" : null, "aria-selected": selected ? "true" : "false" }[name] ?? null),
    scrollIntoView() { if (type === "file") fileScrolled++; },
    click() {
      expanded = "true";
      if (filePath === "src") treeRows.set("deep", makeTreeRow("src/deep", "folder", "false"));
      else if (filePath === "src/deep") treeRows.set("file", makeTreeRow("src/deep/test.py", "file"));
      else if (type === "file") { selected = true; fileClicked++; }
    },
  };
};
treeRows.set("src", makeTreeRow("src", "folder", "false"));
const treeInfo = { path: "src/deep/test.py", absolute: "C:/work/src/deep/test.py", session: { directory: "C:/work" } };
assert.equal(sandbox.revealFileInTree(treeViewer, treeInfo), "pending", "Expand the first collapsed parent");
assert.equal(sandbox.revealFileInTree(treeViewer, treeInfo), "pending", "Expand the next parent after it appears");
assert.equal(sandbox.revealFileInTree(treeViewer, treeInfo), "done", "Reveal and scroll to the opened file");
assert.equal(fileScrolled, 1);
assert.equal(fileClicked, 1, "Select the opened file through the native tree row");
assert.equal(treeRows.get("file").getAttribute("data-item-selected"), "true");
assert.equal(sandbox.revealFileInTree(treeViewer, treeInfo), "done");
assert.equal(fileClicked, 1, "Do not click a file that is already selected");
const shadowViewer = { closest: () => ({ querySelector: () => ({
  querySelectorAll: selector => selector === 'file-tree-container' ? [{ shadowRoot: tree }] : [],
}) }) };
assert.equal(sandbox.revealFileInTree(shadowViewer, treeInfo), "done", "Find native rows inside the file-tree shadow root");
async function testExpandFileParents() {
  const calls = [];
  const info = { ...treeInfo, screen: { file: { root: 'C:/work', tree: {
    sync: async path => calls.push(['sync', path]),
    expand: path => calls.push(['expand', path]),
  } } } };
  assert.equal(await sandbox.expandFileParents(info, () => true), true);
  assert.deepEqual(calls, [['sync', ''], ['expand', 'src'], ['sync', 'src'], ['expand', 'src/deep'], ['sync', 'src/deep']]);
  calls.length = 0;
  assert.equal(await sandbox.expandFileParents(info, () => false), false);
  assert.equal(calls.length, 0, 'Do not expand folders for a stale tab');
  assert.equal(await sandbox.expandFileParents({ ...info, path: 'C:/outside/test.py' }, () => true), false);
}
const viewer = {
  matches: selector => selector === '[data-component="file"][data-mode="text"]',
  closest: selector => selector === '[role="tabpanel"]' ? { getAttribute: () => "file-tab" } : {},
};
const code = { matches: selector => selector.includes("[data-code]") };
const event = {
  button: 0, defaultPrevented: false, stopped: false,
  composedPath: () => [code, viewer],
  stopImmediatePropagation() { this.stopped = true; },
};
assert.equal(sandbox.filePreviewInfo(viewer, fileCtx, fileDoc).absolute, "C:/work/src/test.py");
assert.equal(sandbox.blockFileCommentGesture(event, fileCtx, fileDoc), true);
assert.equal(event.stopped, true);
assert.equal(event.defaultPrevented, false, "Native text selection must remain enabled");
tabKey = "review:changes";
assert.equal(sandbox.blockFileCommentGesture(event, fileCtx, fileDoc), false, "Git review must not change");
tabKey = "file://src/test.py";
assert.equal(sandbox.blockFileCommentGesture({ ...event, button: 2 }, fileCtx, fileDoc), false);
assert.equal(sandbox.blockFileCommentGesture({ ...event, composedPath: () => [{ tagName: "INPUT" }, viewer] }, fileCtx, fileDoc), false);
assert.equal(sandbox.blockFileCommentGesture({ ...event, composedPath: () => [{ matches: selector => selector.includes('line-comment-v2') }, viewer] }, fileCtx, fileDoc), false);
const nestedTabDoc = { getElementById: () => ({ getAttribute: () => null, closest: () => ({ getAttribute: () => tabKey }) }) };
assert.equal(sandbox.filePreviewInfo(viewer, fileCtx, nestedTabDoc).path, "src/test.py");
const selectedPane = { querySelectorAll: () => [{ querySelector: () => ({}), getAttribute: () => tabKey }] };
const unlabelledViewer = { ...viewer, closest: selector => selector === '[data-slot="session-side-pane"]' ? selectedPane : selector === '[role="tabpanel"]' ? { getAttribute: () => null } : {} };
assert.equal(sandbox.filePreviewInfo(unlabelledViewer, fileCtx, { getElementById: () => null }).path, "src/test.py");

// Test local writes without starting a model request.
async function testEditorIo() {
  const io = require("node:fs/promises");
  const directory = await io.mkdtemp(path.join(os.tmpdir(), "desktop-workflow-editor-"));
  const files = [];
  const check = async (name, before, original, content, expected) => {
    const filename = path.join(directory, name); files.push(filename);
    await io.writeFile(filename, before);
    const result = await sandbox.saveLocalText({ path: filename, original, content }, io, path);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(await io.readFile(filename), expected);
    return filename;
  };
  try {
    const filename = await check("sample.py", Buffer.from("x = 1\n"), "x = 1\n", "x = 2\n", Buffer.from("x = 2\n"));
    assert.equal((await sandbox.saveLocalText({ path: filename, original: "x = 2\n", content: "text\0binary" }, io, path)).ok, false);
    assert.equal((await sandbox.saveLocalText({ path: filename, original: "x = 2\n", content: "invalid\ud800" }, io, path)).ok, false);
    assert.equal(await io.readFile(filename, "utf8"), "x = 2\n", "Invalid new text must leave the original file unchanged");
    const conflict = await sandbox.saveLocalText({ path: filename, original: "x = 1\n", content: "x = 3\n" }, io, path);
    assert.equal(conflict.ok, false); assert.match(conflict.message, /外部修改/);
    assert.equal(await io.readFile(filename, "utf8"), "x = 2\n");
    await check("bom.ps1", Buffer.concat([Buffer.from([239,187,191]), Buffer.from("x = 1\r\n")]), "x = 1\r\n", "x = 2\n", Buffer.concat([Buffer.from([239,187,191]), Buffer.from("x = 2\r\n")]));
    await check("utf16.ps1", Buffer.concat([Buffer.from([255,254]), Buffer.from("x = 1\r\n", "utf16le")]), "x = 1\r\n", "x = 2\n", Buffer.concat([Buffer.from([255,254]), Buffer.from("x = 2\r\n", "utf16le")]));
    await check("utf16be.txt", Buffer.concat([Buffer.from([254,255]), Buffer.from("x = 1\n", "utf16le").swap16()]), "x = 1\n", "x = 2\n", Buffer.concat([Buffer.from([254,255]), Buffer.from("x = 2\n", "utf16le").swap16()]));
    assert.equal((await sandbox.saveLocalText({ path: "relative.py", original: "", content: "" }, io, path)).ok, false);
    assert.equal((await sandbox.saveLocalText({ path: filename, original: "x = 2\n", content: "" }, io, path, AbortSignal.abort())).ok, false);
    assert.equal((await sandbox.saveLocalText({ path: filename, original: "x = 2\n", content: "x".repeat(2 * 1024 * 1024 + 1) }, io, path)).ok, false);
    assert.equal((await sandbox.saveLocalText({ path: directory, original: "", content: "" }, io, path)).ok, false);
    let oversizedBaselineTouchedDisk = false;
    const oversizedBaseline = await sandbox.saveLocalText({
      path: path.join(directory, "baseline.txt"), original: "x".repeat(4 * 1024 * 1024 + 1), content: ""
    }, { lstat: async () => { oversizedBaselineTouchedDisk = true; } }, path);
    assert.equal(oversizedBaseline.ok, false);
    assert.equal(oversizedBaselineTouchedDisk, false, "Reject oversized IPC baselines before filesystem access");
    let oversizedFileRead = false;
    const oversizedFileSystem = {
      lstat: async () => ({ isFile: () => true, size: 2 * 1024 * 1024 + 1 }),
      open: async () => { oversizedFileRead = true; throw new Error("Oversized files must not be opened"); },
    };
    const oversized = await sandbox.saveLocalText({ path: path.join(directory, "large.txt"), original: "", content: "" }, oversizedFileSystem, path);
    assert.equal(oversized.ok, false);
    assert.equal(oversizedFileRead, false, "Reject large files before opening them");
    let symlinkOpened = false;
    const symlink = await sandbox.saveLocalText({ path: path.join(directory, "link.txt"), original: "", content: "" }, {
      lstat: async () => ({ isFile: () => false, size: 0 }),
      open: async () => { symlinkOpened = true; throw new Error("Symlinks must not be opened"); },
    }, path);
    assert.equal(symlink.ok, false);
    assert.equal(symlinkOpened, false, "Reject symlinks before opening their targets");
    const replacedPath = await sandbox.saveLocalText({ path: path.join(directory, "replaced.txt"), original: "x", content: "y" }, {
      lstat: async () => ({ isFile: () => true, size: 1, dev: 1, ino: 1 }),
      open: async () => ({ stat: async () => ({ isFile: () => true, size: 1, dev: 1, ino: 2 }), close: async () => {} }),
    }, path);
    assert.equal(replacedPath.ok, false, "Reject a path replaced between lstat and open");
    const invalidUtf16Path = path.join(directory, "invalid-utf16.txt");
    const invalidUtf16 = Buffer.from([0xff, 0xfe, 0x00, 0xd8]);
    files.push(invalidUtf16Path);
    await io.writeFile(invalidUtf16Path, invalidUtf16);
    const invalidUtf16Result = await sandbox.saveLocalText({ path: invalidUtf16Path, original: "", content: "safe" }, io, path);
    assert.equal(invalidUtf16Result.ok, false, "Reject malformed UTF-16 instead of replacing bytes");
    assert.deepEqual(await io.readFile(invalidUtf16Path), invalidUtf16);
  } finally { for (const filename of files) await io.unlink(filename); await io.rmdir(directory); }
}
async function testLanguageSwitch() {
  const effects = [], timers = new Map();
  let nextTimer = 0, locale = "en";
  const summary = { isConnected: true, textContent: "", dataset: {}, setAttribute() {}, remove() {} };
  const wrapper = {
    isConnected: true, getClientRects: () => [{}],
    getAttribute: name => name === "data-timeline-part-id" ? "web" : null,
    setAttribute() {}, removeAttribute() {}, appendChild(node) { assert.equal(node, summary); },
  };
  const localeDoc = {
    ...document,
    querySelectorAll: selector => selector.startsWith('[data-component="tool-part-wrapper"][data-timeline-part-id]') ? [wrapper] : [],
    createElement: () => summary,
  };
  const runtime = {
    ...sandbox, module: { exports: {} }, document: localeDoc,
    getComputedStyle: () => ({ visibility: "visible" }),
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === "solid-js") return { ...sandbox.require(name), createEffect(fn) { effects.push(fn); fn(); }, onCleanup() {} };
      return sandbox.require(name);
    },
  };
  vm.runInNewContext(guiSource, runtime);
  const ui = runtime.module.exports;
  const current = { ...session, server: { client: {
    event: { async *subscribe() {} },
    session: { context: async () => [{ type: "assistant", content: [{ ...webpage, type: "tool", id: "web" }] }] },
  } } };
  const release = ui.setup({
    sessions: { current: () => current },
    layout: { narrow: () => false, side: { opened: () => false, toggle() {} } },
    links: { exists: async () => false }, add() {},
    t: (key, params = {}) => (ui.i18n[locale]?.[key] || ui.i18n.en[key] || key)
      .replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`)),
  });
  const flush = async () => {
    // Let the context promise settle before flushing the fake UI scheduler.
    await new Promise(resolve => setImmediate(resolve));
    const pending = [...timers.values()]; timers.clear();
    for (const callback of pending) callback();
  };
  try {
    await flush();
    assert.equal(summary.textContent, "Completed · Read webpage · https://example.com/");
    locale = "zh"; for (const effect of effects) effect(); await flush();
    assert.equal(summary.textContent, "已完成 · 读取网页 · https://example.com/", "Existing summaries follow a language change without tool events");
    locale = "en"; for (const effect of effects) effect(); await flush();
    assert.equal(summary.textContent, "Completed · Read webpage · https://example.com/", "Switching back removes injected Chinese UI text");
  } finally { release(); }
  assert.equal(timers.size, 0, "Language update timers are cancelled on cleanup");
}
const source = fs.readFileSync(path.join(__dirname, "server.ts"), "utf8").replace(/^import [^\r\n]*\r?\n/, "").replace("export default", "module.exports =");
let hookRegistered = false;
const server = { module: { exports: {} }, Plugin: { define: value => value } };
vm.runInNewContext(source, server);
Promise.resolve(server.module.exports.setup({ session: { hook: () => { hookRegistered = true; } } })).then(async () => {
  assert.equal(server.module.exports.id, "desktop-workflow", "Keep the existing plugin namespace");
  assert.equal(hookRegistered, false, "A desktop UX plugin must not inject a model language policy");
  assert.ok(!source.includes("Simplified Chinese"));
  await testExpandFileParents();
  await testEditorIo();
  await testLanguageSwitch();
  console.log("PASS: file links and session guards, localized tool summaries and live language switching, collapse state, focus toggle, source gestures, UTF-8/UTF-16 saves, BOM/CRLF preservation, oversize/symlink/path-swap/conflict guards, cleanup, diagnostics path fallback, and no model language hook.");
}).catch(error => { console.error(error); process.exitCode = 1; });
