"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");

async function test() {
  const source = await fs.readFile(path.join(__dirname, "../plugins/opencode-plugin-workspace-navigation/gui-experimental.cjs"), "utf8");
  const sandbox = {
    module: { exports: {} },
    require(name) {
      if (name === "@opencode/plugin/gui") return { Plugin: { define: definition => definition }, Ipc: { define: spec => spec } };
      if (name === "effect") return { Schema: { String: {}, Number: {}, Array: value => value, Struct: value => value } };
      if (name === "solid-js") return {};
      throw new Error(`Unexpected runtime dependency: ${name}`);
    },
  };
  vm.runInNewContext(source, sandbox);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-navigation-test-"));
  try {
    for (const name of [".fixtures/knowledge", "docs", ".git", "node_modules", ".venv"]) {
      await fs.mkdir(path.join(directory, name), { recursive: true });
    }
    for (const name of [".fixtures/knowledge/project-report.md", "docs/project-report.md", "docs/project-report.md.bak", ".git/report.md", "node_modules/report.md", ".venv/report.md"]) {
      await fs.writeFile(path.join(directory, name), "Test fixture only\n");
    }
    const input = { directory, query: "report md", limit: 5000 };
    const found = await sandbox.findWorkspaceFiles(input, fs, path);
    assert.deepEqual(Array.from(found, entry => entry.path).sort(), [".fixtures/knowledge/project-report.md", "docs/project-report.md"]);
    await fs.writeFile(path.join(directory, "docs/new-report.md"), "New fixture\n");
    assert.equal((await sandbox.findWorkspaceFiles(input, fs, path)).length, 2, "Cache lifetime is deliberate");
    sandbox.clearWorkspaceIndexes();
    assert.equal((await sandbox.findWorkspaceFiles(input, fs, path)).length, 3, "Cleanup invalidates cached names");
    await assert.rejects(sandbox.findWorkspaceFiles(input, fs, path, AbortSignal.abort()), { name: "AbortError" });
  } finally {
    sandbox.clearWorkspaceIndexes();
    // Only remove this test's freshly created, uniquely named directory.
    await fs.rm(directory, { recursive: true, force: true });
  }
  console.log("PASS: real filesystem, hidden files, exact extensions, excluded directories, cache invalidation, and cancellation.");
}

test().catch(error => { console.error(error); process.exitCode = 1; });
