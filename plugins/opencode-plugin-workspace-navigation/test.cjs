"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");

const packageMetadata = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
assert.equal(packageMetadata.name, "opencode-plugin-workspace-navigation");
const filename = path.join(__dirname, "gui-experimental.cjs");
const pluginCleanups = [];
const attributes = new Map();
const root = {
  getAttribute: key => attributes.get(key) ?? null,
  setAttribute: (key, value) => attributes.set(key, value),
  removeAttribute: key => attributes.delete(key)
};
const contributions = new Map();
const moduleObject = { exports: {} };
const sandbox = {
  module: moduleObject,
  document: { documentElement: root },
  require(name) {
    if (name === "effect") return { Schema: { String: "string", Number: "number", Struct: value => value, Array: value => value } };
    if (name === "solid-js") return { onCleanup: cleanup => pluginCleanups.push(cleanup) };
    assert.equal(name, "@opencode/plugin/gui");
    return { Plugin: { define: x => x }, Style: "style", Theme: "theme", Command: "command", Ipc: { define: x => x }, createKeyed: (read, run) => run(read()) };
  }
};
vm.runInNewContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
const definition = moduleObject.exports;
assert.equal(definition.i18n, undefined);
assert.equal(sandbox.enhanceFileSearch(undefined, () => true).installed, false);
root.setAttribute("data-fiori-style", "off");
async function testSetupSearchAdapter() {
  definition.setup({ t: key => key, add() {} })();
  assert.doesNotThrow(() => definition.setup({ sessions: {} })(), "A changed session API must not break startup");
  assert.equal(root.getAttribute("data-fiori-style"), "off");
  const searchCalls = [];
  const inheritedFile = Object.create({
    async find(params) {
      searchCalls.push(params);
      return { data: [{ path: "docs/project-report.md" }] };
    },
  });
  const searchInput = { value: "report" };
  sandbox.document.querySelector = () => searchInput;
  const searchSession = { directory: "C:/workspace", server: { local: true, client: { file: inheritedFile } } };
  const searchCleanup = definition.setup({
    sessions: { current: () => searchSession }, desktop: { os: "windows" },
    main: () => ({ find: async () => [{ path: ".fixtures/knowledge/project-report.md" }] }),
    t: key => key, add() {},
  });
  assert.equal(JSON.parse(root.getAttribute("data-workspace-navigation-search")).installed, true,
    "Install the search adapter when file.find is inherited from the client prototype");
  const searchResult = await inheritedFile.find({ type: "file", query: "report", limit: 200, location: { directory: searchSession.directory } });
  assert.equal(searchCalls[0].limit, 5000);
  assert.deepEqual(JSON.parse(JSON.stringify(searchResult.data.map(entry => entry.path).sort())), [".fixtures/knowledge/project-report.md", "docs/project-report.md"]);
  const searchStatus = JSON.parse(root.getAttribute("data-workspace-navigation-search"));
  assert.equal(searchStatus.serverReturned, 1);
  assert.equal(searchStatus.localReturned, 1);
  searchCleanup();
  assert.equal(root.getAttribute("data-fiori-style"), "off", "Navigation must not alter theme state");
  pluginCleanups.pop()();
  assert.equal(Object.hasOwn(inheritedFile, "find"), false);
  const disabled = definition.setup({ options: { enabled: false }, sessions: { current: () => searchSession } });
  assert.equal(Object.hasOwn(inheritedFile, "find"), false);
  assert.equal(JSON.parse(root.getAttribute("data-workspace-navigation-search")).installed, false);
  disabled();
  searchSession.server.local = false;
  let localCalls = 0;
  const remoteCleanup = definition.setup({
    sessions: { current: () => searchSession },
    main: () => ({ find: async () => { localCalls++; return []; } }),
  });
  await inheritedFile.find({ type: "file", query: "report", location: { directory: "/remote/workspace" } });
  assert.equal(localCalls, 0, "A remote workspace must not scan this machine");
  remoteCleanup();
  pluginCleanups.pop()();
}
async function testSearch() {
  await testSetupSearchAdapter();
  await testWorkspaceSearch();
  await testSearchBoundaries();
  await testIndexBudgets();
  const paths = ["path/technical-other.md", "technical/notes.md", "technical.md", "path/technical.md", "path/my-technical.md", "fuzzy/t-e-c-h.md"];
  const ranked = sandbox.rankFileEntries(paths.map(path => ({ path })), "technical");
  assert.equal(ranked[0].path, "technical.md");
  assert.equal(ranked[1].path, "path/technical.md");
  assert.equal(ranked[ranked.length - 1].path, "fuzzy/t-e-c-h.md");
  assert.equal(ranked.length, paths.length);
  assert.equal(sandbox.rankFileEntries([{ path: "INFO.TXT" }], "info")[0].path, "INFO.TXT");
  assert.equal(sandbox.rankFileEntries([{ path: null }], "missing").length, 1);
  assert.equal(sandbox.matchesFileSearch('docs/PROJECT-REPORT.MD', sandbox.fileSearchTerms(' REPORT   md ')), true);
  assert.equal(sandbox.matchesFileSearch('docs/project-report.md.bak', sandbox.fileSearchTerms('report md')), false);
  assert.equal(sandbox.matchesFileSearch('md/project-report.ts', sandbox.fileSearchTerms('report md')), false);
  assert.equal(sandbox.matchesFileSearch('.fixtures/knowledge/project-report.md', sandbox.fileSearchTerms('knowledge report .md')), true);
  assert.equal(sandbox.matchesFileSearch('docs/project-report.md', sandbox.fileSearchTerms('knowledge report md')), false);
  const many = Array.from({ length: 2500 }, (_, index) => ({ path: `folder-${index}/technical.md` }));
  assert.equal(sandbox.rankFileEntries(many, "technical").length, 2500);
  const calls = [];
  const signal = new AbortController().signal;
  const file = { async find(params, options) {
    assert.equal(this, file);
    calls.push({ params, options });
    return { location: { directory: params.location.directory }, data: paths.map(path => ({ path })) };
  } };
  const original = file.find;
  let active = true;
  const restore = sandbox.enhanceFileSearch(file, () => active);
  const params = { location: { directory: "C:/workspace" }, type: "file", query: "technical", limit: 200 };
  await file.find(params, { signal });
  assert.equal(calls[0].params.limit, 5000);
  assert.equal(calls[0].options.signal, signal);
  assert.equal(params.limit, 200);
  active = false;
  await file.find({ ...params, limit: 100 }, { signal });
  assert.equal(calls[1].params.limit, 100);
  active = true;
  await file.find({ ...params, type: "directory" });
  assert.equal(calls[2].params.limit, 200);
  await file.find({ ...params, limit: 5 });
  assert.equal(calls[3].params.limit, 5000);
  await file.find({ ...params, query: 42 });
  assert.equal(calls[4].params.limit, 200);
  restore();
  assert.equal(file.find, original);
  const inheritedCalls = [];
  const inheritedMethod = async function(params) {
    inheritedCalls.push(params);
    return { data: [] };
  };
  const inheritedFile = Object.create({ find: inheritedMethod });
  const restoreInherited = sandbox.enhanceFileSearch(inheritedFile, () => true);
  assert.equal(restoreInherited.installed, true);
  await inheritedFile.find({ type: "file", query: "technical", limit: 50 });
  assert.equal(inheritedCalls[0].limit, 5000);
  restoreInherited();
  assert.equal(Object.hasOwn(inheritedFile, "find"), false);
  const multiCalls = [];
  const multiFile = { async find(params) {
    multiCalls.push(params);
    return { data: [{ path: 'docs/report.md' }, { path: 'docs/report.ts' }, { path: 'docs/other.md' }] };
  } };
  const restoreMulti = sandbox.enhanceFileSearch(multiFile, () => true, undefined,
    async () => [{ path: '.fixtures/knowledge/report.md' }, { path: 'md/report.txt' }]);
  const multiResult = await multiFile.find({ type: 'file', query: 'report md', limit: 200 });
  assert.equal(multiCalls[0].query, 'report');
  assert.deepEqual(JSON.parse(JSON.stringify(multiResult.data.map(entry => entry.path).sort())),
    ['.fixtures/knowledge/report.md', 'docs/report.md']);
  restoreMulti();
  const restoreAgain = sandbox.enhanceFileSearch(file, () => true);
  const newer = () => {};
  file.find = newer;
  restoreAgain();
  assert.equal(file.find, newer);
  const readOnly = {};
  Object.defineProperty(readOnly, "find", { value: original, writable: false, configurable: true });
  const restoreReadOnly = sandbox.enhanceFileSearch(readOnly, () => true);
  assert.equal(restoreReadOnly.installed, false);
  assert.equal(readOnly.find, original);
  assert.doesNotThrow(restoreReadOnly);
  const proxied = new Proxy({ find: original }, { set() { throw new TypeError("read-only client"); } });
  assert.doesNotThrow(() => sandbox.enhanceFileSearch(proxied, () => true));
  assert.equal(proxied.find, original);
  const caseFile = { async find() { return { data: [{ path: "docs/Foo.md" }, { path: "docs/foo.md" }] }; } };
  const restoreCase = sandbox.enhanceFileSearch(caseFile, () => true, undefined,
    async () => [{ path: "docs/foo.md" }]);
  assert.equal((await caseFile.find({ type: "file", query: "foo" })).data.length, 2,
    "Case-insensitive matching must not merge distinct file paths");
  restoreCase();
  const fallbackFile = { async find() { return { data: [{ path: "docs/a.md" }] }; } };
  const restoreFallback = sandbox.enhanceFileSearch(fallbackFile, () => true, undefined,
    async () => { throw new Error("Local scan unavailable"); });
  assert.equal((await fallbackFile.find({ type: "file", query: "a" })).data[0].path, "docs/a.md");
  restoreFallback();
  const cancelledDuringLocal = new AbortController();
  let forwardedSignal;
  const cancellable = { async find() { return { data: [{ path: "docs/report.md" }] }; } };
  const restoreCancelled = sandbox.enhanceFileSearch(cancellable, () => true, undefined, async (_, options) => {
    forwardedSignal = options.signal;
    cancelledDuringLocal.abort();
    throw new Error("Cancelled local request");
  });
  await assert.rejects(cancellable.find({ type: "file", query: "report" }, { signal: cancelledDuringLocal.signal }), { name: "AbortError" });
  assert.equal(forwardedSignal, cancelledDuringLocal.signal);
  restoreCancelled();
  let nativeCalls = 0;
  const nativeFallback = { async find() { nativeCalls++; return { data: [] }; } };
  const restoreChangedUi = sandbox.enhanceFileSearch(nativeFallback, () => { throw new Error("Changed host UI"); });
  await nativeFallback.find({ type: "file", query: "report" });
  assert.equal(nativeCalls, 1, "A failed UI scope check must preserve native search");
  restoreChangedUi();
  let scope = { key: "original-session", local: false };
  let capturedScope;
  const switchingFile = { async find() {
    scope = { key: "next-session", local: true };
    return { data: [] };
  } };
  const restoreSwitching = sandbox.enhanceFileSearch(switchingFile, () => true, undefined,
    async (_, __, captured) => { capturedScope = captured; return []; }, () => scope);
  await switchingFile.find({ type: "file", query: "report" });
  assert.equal(capturedScope.key, "original-session");
  assert.equal(capturedScope.local, false, "Local/remote scope must be captured before an asynchronous request");
  restoreSwitching();
  await testThemeIsolation();
}

async function testThemeIsolation() {
  const themePath = path.join(__dirname, "../opencode-plugin-fiori-horizon/gui-experimental.cjs");
  if (!fs.existsSync(themePath)) {
    console.log("SKIP: cross-plugin isolation test; Fiori package is not installed beside Navigation.");
    return;
  }
  const file = { async find() { return { data: [{ path: "docs/a.md" }] }; } };
  const original = file.find;
  sandbox.document.querySelector = () => ({ value: "a" });
  const navigationCleanup = definition.setup({
    sessions: { current: () => ({ server: { local: true, client: { file } } }) },
    main: () => ({ find: async () => [] }),
  });
  const wrapped = file.find;
  assert.notEqual(wrapped, original);
  const themeSandbox = {
    document: sandbox.document, module: { exports: {} },
    require(name) {
      assert.equal(name, "@opencode/plugin/gui");
      return { Plugin: { define: value => value }, Theme: "theme", Style: "style", Command: "command" };
    },
  };
  vm.runInNewContext(fs.readFileSync(themePath, "utf8"), themeSandbox);
  const themeCleanup = themeSandbox.module.exports.setup({ t: key => key, add() {} });
  assert.equal(file.find, wrapped, "Loading the theme must not wrap search again");
  assert.equal(root.getAttribute("data-fiori-style"), "on");
  navigationCleanup();
  assert.equal(file.find, original);
  assert.equal(root.getAttribute("data-fiori-style"), "on", "Disabling navigation must preserve theme styling");
  pluginCleanups.pop()();
  themeCleanup();
  const searchCleanup = definition.setup({
    sessions: { current: () => ({ server: { local: true, client: { file } } }) },
    main: () => ({ find: async () => [] }),
  });
  const searchWrapped = file.find;
  const cleanupTheme = themeSandbox.module.exports.setup({ t: key => key, add() {} });
  cleanupTheme();
  assert.equal(file.find, searchWrapped, "Disabling the theme must preserve navigation");
  searchCleanup();
  pluginCleanups.pop()();
}

async function testWorkspaceSearch() {
  const directory = (name, children) => ({ name, children, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false });
  const file = name => ({ name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false });
  const tree = new Map([
    ["/workspace", [directory(".fixtures"), directory(".git"), directory("docs"), directory("node_modules"), file("README.md")]],
    ["/workspace/.fixtures", [directory("knowledge")]],
    ["/workspace/.fixtures/knowledge", [file("project-report.md")]],
    ["/workspace/.git", [directory("objects")]],
    ["/workspace/.git/objects", [file("report-object")]],
    ["/workspace/docs", [file("project-report-guide.md"), file("overview.md")]],
    ["/workspace/node_modules", [directory("pkg")]],
    ["/workspace/node_modules/pkg", [file("report.js")]],
  ]);
  const fsMock = {
    async realpath(value) { return value; },
    async stat() { return { isDirectory: () => true }; },
    async readdir(value) { return tree.get(value) || []; },
  };
  const matches = await sandbox.findWorkspaceFiles({ directory: "/workspace", query: "report", limit: 5000 }, fsMock, path.posix);
  assert.deepEqual(JSON.parse(JSON.stringify(matches.map(entry => entry.path).sort())), [
    ".fixtures/knowledge/project-report.md",
    "docs/project-report-guide.md",
  ]);
  const multiMatches = await sandbox.findWorkspaceFiles({ directory: '/workspace', query: 'knowledge report md', limit: 5000 }, fsMock, path.posix);
  assert.deepEqual(JSON.parse(JSON.stringify(multiMatches)), [{ path: '.fixtures/knowledge/project-report.md' }]);
  assert.equal((await sandbox.findWorkspaceFiles({ directory: '/workspace', query: 'report ts', limit: 5000 }, fsMock, path.posix)).length, 0);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    sandbox.findWorkspaceFiles({ directory: "/workspace", query: "readme", limit: 5000 }, fsMock, path.posix, cancelled.signal),
    { name: "AbortError" },
  );
}

async function testSearchBoundaries() {
  sandbox.clearWorkspaceIndexes();
  let reads = 0;
  const regularFile = name => ({ name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false });
  const folder = name => ({ name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false });
  const io = {
    realpath: async value => value,
    stat: async () => ({ isDirectory: () => true }),
    readdir: async () => { reads++; return [regularFile("report.md")]; },
  };
  const request = directory => ({ directory, query: "report", limit: 5000 });
  await sandbox.findWorkspaceFiles(request("/cache-a"), io, path.posix);
  await sandbox.findWorkspaceFiles(request("/cache-a"), io, path.posix);
  assert.equal(reads, 1, "Completed scans are cached");
  for (let index = 0; index < 6; index++) await sandbox.findWorkspaceFiles(request(`/cache-${index}`), io, path.posix);
  const beforeEvictedRead = reads;
  await sandbox.findWorkspaceFiles(request("/cache-a"), io, path.posix);
  assert.equal(reads, beforeEvictedRead + 1, "Old roots are evicted rather than retained without limit");
  const originalDate = sandbox.Date;
  let now = Date.now();
  sandbox.Date = { now: () => now };
  try {
    await sandbox.findWorkspaceFiles(request("/expiring-cache"), io, path.posix);
    const beforeExpiry = reads;
    now += 15001;
    await sandbox.findWorkspaceFiles(request("/expiring-cache"), io, path.posix);
    assert.equal(reads, beforeExpiry + 1, "Expired roots must be rescanned");
  } finally {
    if (originalDate) sandbox.Date = originalDate;
    else delete sandbox.Date;
  }

  const abort = new AbortController();
  let touched = false;
  await assert.rejects(sandbox.findWorkspaceFiles(request("/pre-cancelled"), {
    realpath: async () => { touched = true; },
  }, path.posix, AbortSignal.abort()), { name: "AbortError" });
  assert.equal(touched, false, "An already-cancelled search must not touch disk");
  const cancellingIo = { ...io, readdir: async () => { abort.abort(); return [regularFile("report.md")]; } };
  await assert.rejects(sandbox.findWorkspaceFiles(request("/cancel-scan"), cancellingIo, path.posix, abort.signal), { name: "AbortError" });
  const retry = await sandbox.findWorkspaceFiles(request("/cancel-scan"), io, path.posix);
  assert.equal(retry.length, 1, "A cancelled scan must not cache partial results");

  const cleanupIo = { ...io, readdir: async () => { sandbox.clearWorkspaceIndexes(); return []; } };
  await assert.rejects(sandbox.findWorkspaceFiles(request("/unloading"), cleanupIo, path.posix), { name: "AbortError" });

  let enteredRedirect = false;
  const redirectedIo = {
    ...io,
    realpath: async value => value.endsWith("/redirect") ? "/outside" : value,
    readdir: async value => {
      if (value.endsWith("/redirect")) enteredRedirect = true;
      return value === "/safe-root" ? [folder("redirect"), regularFile("report.md")] : [];
    },
  };
  assert.equal((await sandbox.findWorkspaceFiles(request("/safe-root"), redirectedIo, path.posix)).length, 1);
  assert.equal(enteredRedirect, false, "A queued directory redirected by a symlink must not be traversed");
  const symbolicEntry = { ...folder("link"), isSymbolicLink: () => true };
  let visitedSymbolicChild = false;
  await sandbox.findWorkspaceFiles(request("/symbolic-root"), { ...io, readdir: async value => {
    if (value !== "/symbolic-root") visitedSymbolicChild = true;
    return value === "/symbolic-root" ? [symbolicEntry] : [];
  } }, path.posix);
  assert.equal(visitedSymbolicChild, false, "Known symbolic children must not be queued");
  await assert.rejects(sandbox.findWorkspaceFiles(request("/unreadable-root"), {
    ...io, readdir: async () => { throw new Error("Access denied"); },
  }, path.posix), /Access denied/);
  assert.equal((await sandbox.findWorkspaceFiles(request("/unreadable-root"), io, path.posix)).length, 1,
    "An unreadable root must not cache an empty successful index");
  sandbox.clearWorkspaceIndexes();
}

async function testIndexBudgets() {
  // Exercise the production traversal with small limits, without a 150k-file fixture.
  const source = fs.readFileSync(filename, "utf8");
  const defaults = "files: 150000, directories: 50000, roots: 4, results: 5000";
  assert.ok(source.includes(defaults), "Update the budget test when the documented defaults change");
  const bounded = { ...sandbox, module: { exports: {} } };
  vm.runInNewContext(source.replace(defaults, "files: 3, directories: 2, roots: 4, results: 5000"), bounded);
  const file = name => ({ name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false });
  const folder = name => ({ name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false });
  let visited = 0;
  const io = {
    realpath: async value => value, stat: async () => ({ isDirectory: () => true }),
    readdir: async value => {
      visited++;
      return value === "/directory-budget" ? [folder("a"), folder("b"), folder("c")] : [file("report.md")];
    },
  };
  await bounded.findWorkspaceFiles({ directory: "/directory-budget", query: "report" }, io, path.posix);
  assert.equal(visited, 2, "Empty/deep directory trees must respect the directory budget");
  const manyFiles = { ...io, readdir: async () => Array.from({ length: 10 }, (_, index) => file(`report-${index}.md`)) };
  assert.equal((await bounded.findWorkspaceFiles({ directory: "/file-budget", query: "report" }, manyFiles, path.posix)).length, 3);
}

testSearch().then(() => {
  console.log("PASS: independent navigation, scoped search, local/remote guard, disable and cleanup, AND matching, case-sensitive identity, fallback and signal forwarding.");
}).catch(error => { console.error(error); process.exitCode = 1; });
