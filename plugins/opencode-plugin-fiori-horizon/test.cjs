"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");

const metadata = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
assert.equal(metadata.name, "opencode-plugin-fiori-horizon");
assert.equal(metadata.exports["."], "./server.ts");
const serverSource = fs.readFileSync(path.join(__dirname, "server.ts"), "utf8")
  .replace(/^import [^\r\n]*\r?\n/, "").replace("export default", "module.exports =");
const serverSandbox = { Plugin: { define: value => value }, module: { exports: {} } };
vm.runInNewContext(serverSource, serverSandbox);
assert.equal(serverSandbox.module.exports.id, "fiori-horizon-light");
assert.equal(serverSandbox.module.exports.setup(), undefined, "Server entry is identity-only");
const source = fs.readFileSync(path.join(__dirname, "gui-experimental.cjs"), "utf8");
for (const token of ["file.find", "WorkspaceSearchIpc", "enhanceFileSearch", "createKeyed", "data-fiori-search-adapter"]) {
  assert.ok(!source.includes(token), `Theme must not contain search behavior: ${token}`);
}
const attributes = new Map();
const root = {
  getAttribute: key => attributes.get(key) ?? null,
  setAttribute: (key, value) => attributes.set(key, value),
  removeAttribute: key => attributes.delete(key),
};
const sandbox = {
  module: { exports: {} }, document: { documentElement: root },
  require(name) {
    assert.equal(name, "@opencode/plugin/gui");
    return { Plugin: { define: value => value }, Style: "style", Theme: "theme", Command: "command" };
  },
};
vm.runInNewContext(source, sandbox);
const definition = sandbox.module.exports;
const contributions = new Map();
const file = { find() {} }, original = file.find;
const cleanup = definition.setup({
  sessions: { current: () => ({ server: { client: { file } } }) },
  t: key => definition.i18n.en[key],
  add: (key, value) => contributions.set(key, typeof value === "function" ? value() : value),
});
assert.equal(file.find, original);
assert.equal(root.getAttribute("data-fiori-style"), "on");
assert.equal(contributions.get("theme").name, "Fiori Horizon Light");
assert.equal(contributions.get("theme").id, "fiori-horizon-light");
assert.equal(contributions.get("theme").light.palette.ink, "#131e29");
assert.equal(contributions.get("theme").light.palette.error, "#aa0808");
const css = contributions.get("style");
assert.ok(!css.includes("!important"));
assert.ok(css.includes("background: color-mix(in srgb, var(--fiori-purple) 7%, white);"));
assert.ok(css.includes("color: var(--fiori-purple);"));
const rules = css.split("}").filter(rule => rule.trim());
assert.ok(rules.length > 45);
for (const rule of rules) assert.ok(rule.includes(':root[data-fiori-style="on"][data-color-scheme="light"]'));
for (const slot of ["execute-tool-call-name", "execute-tool-output", "bash-result", "answer-text",
  "session-review-v2-sidebar-title", "tabs-trigger-wrapper", "composer-face", "switch-control"]) {
  assert.ok(css.includes(`[data-slot="${slot}"]`));
}
assert.ok(css.includes("file-tree-container.opencode-pierre-file-tree"));
assert.ok(!css.includes("--trees-font-size:"));
assert.ok(!css.includes("--trees-item-height:"));
assert.equal(sandbox.getDiagnosticDirectory(undefined, "/tmp", 1000, path.posix), "/tmp/opencode-1000");
assert.equal(sandbox.getDiagnosticDirectory("C:\\Users\\Tester\\AppData\\Local", "/tmp", 1000, path.win32),
  "C:\\Users\\Tester\\AppData\\Local\\Temp\\opencode");
contributions.get("command").run();
assert.equal(root.getAttribute("data-fiori-style"), "off");
contributions.get("command").run();
assert.equal(root.getAttribute("data-fiori-style"), "on");
cleanup();
assert.equal(root.getAttribute("data-fiori-style"), null);
root.setAttribute("data-fiori-style", "off");
definition.setup({ t: key => key, add() {} })();
assert.equal(root.getAttribute("data-fiori-style"), "off");
assert.ok(definition.i18n.en["command.toggle"]);
assert.ok(definition.i18n.zh["command.toggle"]);
Promise.resolve(definition.main({})).then(() => {
  // The sandbox rejects Electron/Node imports, proving default main is inert.
  if (process.argv.includes("--export")) console.log(JSON.stringify({ css, theme: contributions.get("theme") }));
  else console.log("PASS: pure Fiori theme, unchanged plugin/theme identity and colors, independent toggle and cleanup, no search behavior, and diagnostics off by default.");
}).catch(error => { console.error(error); process.exitCode = 1; });
