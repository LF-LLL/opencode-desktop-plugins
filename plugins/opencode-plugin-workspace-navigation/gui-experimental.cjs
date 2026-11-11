"use strict";

const { Plugin, Ipc, createKeyed } = require("@opencode/plugin/gui");
const { Schema } = require("effect");
const { onCleanup } = require("solid-js");

// Keep resource limits explicit. Indexes contain names only, never file contents.
const searchLimits = Object.freeze({ files: 150000, directories: 50000, roots: 4, results: 5000, cacheMs: 15000 });

function throwIfCancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Workspace search was cancelled");
  error.name = "AbortError";
  throw error;
}

const WorkspaceSearchIpc = Ipc.define({
  id: "opencode-plugin-workspace-navigation.workspace-search",
  methods: {
    find: {
      input: Schema.Struct({ directory: Schema.String, query: Schema.String, limit: Schema.Number }),
      output: Schema.Array(Schema.Struct({ path: Schema.String })),
    },
  },
});

const searchExtensions = new Set([
  "md", "markdown", "abap", "py", "js", "ts", "tsx", "jsx", "cjs", "mjs",
  "json", "jsonc", "xml", "yaml", "yml", "txt", "csv", "html", "css", "sql", "docx", "pdf",
]);

function fileSearchTerms(query) {
  if (typeof query !== "string") return [];
  return [...new Set(query.trim().replaceAll("\\", "/").toLowerCase().split(/\s+/).filter(Boolean))];
}

function matchesFileSearch(path, terms) {
  if (typeof path !== "string") return false;
  const full = path.replaceAll("\\", "/").toLowerCase();
  return terms.every(term => {
    const extension = term.replace(/^\./, "");
    if (terms.length > 1 && searchExtensions.has(extension)) return full.endsWith(`.${extension}`);
    return full.includes(term);
  });
}

function rankFileEntries(entries, query) {
  if (!Array.isArray(entries) || typeof query !== "string") return entries;
  const terms = fileSearchTerms(query);
  if (!terms.length) return entries;
  const scoreTerm = (entry, needle) => {
    const full = typeof entry?.path === "string" ? entry.path.replaceAll("\\", "/").toLowerCase() : "";
    const name = full.slice(full.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    if (name === needle || stem === needle) return 0;
    if (name.startsWith(needle)) return 1;
    if (name.includes(needle)) return 2;
    if (full.includes(needle)) return 3;
    return 4; // Keep the server's fuzzy matches and their order.
  };
  return entries.map((entry, index) => ({ entry, index, score: terms.reduce((sum, term) => sum + scoreTerm(entry, term), 0) }))
    .sort((a, b) => a.score - b.score || a.index - b.index).map(item => item.entry);
}

// Compatibility adapter, not an official search hook. Keep it isolated from themes.
function enhanceFileSearch(file, isSidebarRequest, report, findWorkspaceFiles, captureScope) {
  const original = file?.find;
  const unavailable = () => {
    const cleanup = () => {};
    cleanup.installed = false;
    return cleanup;
  };
  if (typeof original !== "function") return unavailable();
  const descriptor = Object.getOwnPropertyDescriptor(file, "find");
  if ((descriptor && (!Object.hasOwn(descriptor, "value") || !descriptor.writable))
    || (!descriptor && !Object.isExtensible(file))) return unavailable();
  const wrapper = async function(params, options) {
    const query = params?.query;
    let scoped = false;
    try { scoped = isSidebarRequest(params); } catch { /* Host UI may have changed. Use native search. */ }
    if (params?.type !== "file" || typeof query !== "string" || !query.trim() || !scoped) {
      return original.call(this, params, options);
    }
    throwIfCancelled(options?.signal);
    const scope = captureScope?.(); // Capture before the native request yields or the user switches sessions.
    let result, serverError;
    const terms = fileSearchTerms(query);
    try {
      result = await original.call(this, { ...params, query: terms.length > 1 ? terms[0] : query, limit: searchLimits.results }, options);
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      serverError = error;
    }
    let localEntries = [];
    throwIfCancelled(options?.signal);
    const serverEntries = Array.isArray(result?.data) ? result.data : [];
    if (typeof findWorkspaceFiles === "function") {
      try {
        const found = await findWorkspaceFiles({ directory: params.location?.directory, query, limit: searchLimits.results }, options, scope);
        if (Array.isArray(found)) localEntries = found;
      } catch {
        // A local scan must not hide successful server results.
      }
    }
    throwIfCancelled(options?.signal);
    if (serverError && localEntries.length === 0) throw serverError;
    const entriesByPath = new Map();
    for (const entry of [...serverEntries, ...localEntries]) {
      if (typeof entry?.path !== "string") continue;
      if (terms.length > 1 && !matchesFileSearch(entry.path, terms)) continue;
      // Preserve file identity. Case-insensitive matching does not imply identity.
      const key = entry.path.replaceAll("\\", "/").replace(/^\.\//, "");
      if (!entriesByPath.has(key)) entriesByPath.set(key, entry);
    }
    const entries = [...entriesByPath.values()];
    try {
      report?.({ installed: true, requestedLimit: Number(params.limit) || null, effectiveLimit: searchLimits.results,
        serverReturned: serverEntries.length, localReturned: localEntries.length, returned: Math.min(entries.length, searchLimits.results) });
    } catch {
      // Diagnostics must not fail a successful search.
    }
    return { ...(result || { location: params.location }), data: rankFileEntries(entries, query).slice(0, searchLimits.results) };
  };
  try { file.find = wrapper; } catch { return unavailable(); }
  if (file.find !== wrapper) return unavailable();
  const cleanup = () => {
    if (file.find !== wrapper) return; // Do not overwrite a newer extension.
    try {
      if (descriptor) Object.defineProperty(file, "find", descriptor);
      else delete file.find;
    } catch {
      try {
        if (descriptor) file.find = original;
        else delete file.find;
      } catch { /* Best-effort cleanup for a locked host client. */ }
    }
  };
  cleanup.installed = true;
  return cleanup;
}

const workspaceIndexCache = new Map();
let indexGeneration = 0;
function clearWorkspaceIndexes() {
  indexGeneration++;
  workspaceIndexCache.clear();
}
const skippedSearchDirectories = new Set([
  ".git", ".venv", "node_modules", "__pycache__", ".pytest_cache", ".playwright-mcp",
]);

async function getWorkspaceFileIndex(directory, fs, pathModule, signal, lifecycleSignal) {
  const generation = indexGeneration;
  const check = () => {
    throwIfCancelled(signal);
    throwIfCancelled(lifecycleSignal);
    if (generation !== indexGeneration) throwIfCancelled({ aborted: true });
  };
  check();
  const root = await fs.realpath(directory);
  check();
  const cacheKey = pathModule.resolve(root);
  for (const [key, record] of workspaceIndexCache) {
    if (record.expires <= Date.now()) workspaceIndexCache.delete(key);
  }
  const cached = workspaceIndexCache.get(cacheKey);
  if (cached) {
    workspaceIndexCache.delete(cacheKey);
    workspaceIndexCache.set(cacheKey, cached); // Least recently used roots are evicted first.
    return cached.files;
  }
  // Cache completed scans only: one caller's cancellation must not poison another.
  const rootStat = await fs.stat(root);
  check();
  if (!rootStat.isDirectory()) return [];
  const files = [], directories = [root];
  let scheduledDirectories = 1;
  while (directories.length && files.length < searchLimits.files) {
    check();
    const current = directories.pop();
    let entries;
    try {
      // Recheck queued directories: they may have become symlinks since enumeration.
      if (pathModule.resolve(await fs.realpath(current)) !== pathModule.resolve(current)) continue;
      check();
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      check();
      if (current === root) throw error;
      continue; // An unreadable child must not hide the rest of the workspace.
    }
    check();
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      check();
      if (entry.isSymbolicLink()) continue;
      const absolute = pathModule.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skippedSearchDirectories.has(entry.name.toLowerCase()) && scheduledDirectories < searchLimits.directories) {
          directories.push(absolute);
          scheduledDirectories++;
        }
      } else if (entry.isFile()) {
        files.push(pathModule.relative(root, absolute).replaceAll("\\", "/"));
        if (files.length >= searchLimits.files) break;
      }
    }
  }
  check();
  if (workspaceIndexCache.size >= searchLimits.roots) workspaceIndexCache.delete(workspaceIndexCache.keys().next().value);
  workspaceIndexCache.set(cacheKey, { expires: Date.now() + searchLimits.cacheMs, files });
  return files;
}

async function findWorkspaceFiles(input, fs, pathModule, signal, lifecycleSignal) {
  throwIfCancelled(signal);
  throwIfCancelled(lifecycleSignal);
  if (!input || typeof input.directory !== "string" || !pathModule.isAbsolute(input.directory)
    || input.directory.includes("\0") || typeof input.query !== "string" || input.query.length > 4096) return [];
  const terms = fileSearchTerms(input.query);
  if (!terms.length) return [];
  const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(input.limit, searchLimits.results)) : searchLimits.results;
  const files = await getWorkspaceFileIndex(input.directory, fs, pathModule, signal, lifecycleSignal);
  const matches = [];
  for (const file of files) {
    throwIfCancelled(signal);
    throwIfCancelled(lifecycleSignal);
    if (matchesFileSearch(file, terms)) {
      matches.push({ path: file });
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

module.exports = Plugin.define({
  main(ctx) {
    const fs = require("node:fs/promises");
    const path = require("node:path");
    ctx.provide(WorkspaceSearchIpc, {
      find: (input, caller) => findWorkspaceFiles(input, fs, path, caller?.signal, ctx.signal),
    });
    return clearWorkspaceIndexes;
  },
  setup(ctx) {
    const root = document.documentElement;
    const attribute = "data-workspace-navigation-search";
    const previous = root.getAttribute(attribute);
    const report = state => root.setAttribute(attribute, JSON.stringify(state));
    const restores = new Set();
    if (ctx.options?.enabled === false) {
      report({ installed: false, reason: "Disabled by plugin options" });
    } else if (typeof createKeyed !== "function" || typeof ctx.sessions?.current !== "function") {
      report({ installed: false, reason: "Session client API unavailable" });
    } else {
      let localSearch;
      try { localSearch = ctx.main?.(WorkspaceSearchIpc); } catch { /* Native server search remains available without IPC. */ }
      createKeyed(() => ctx.sessions.current()?.server?.client, client => {
        const file = client?.file;
        const isSidebarRequest = params => {
          const input = document.querySelector('[data-slot="session-review-v2-sidebar-filter"] input');
          return !!input && input.value.trim() === params.query.trim()
            && typeof params.location?.directory === "string";
        };
        const restore = enhanceFileSearch(file, isSidebarRequest, report, (input, options, scope) => {
          // Main-process paths belong to this machine, not a remote server.
          const current = ctx.sessions.current();
          if (!scope.local || current?.key !== scope.key || current?.server?.client !== scope.client) return [];
          return localSearch?.find(input, { signal: options?.signal });
        }, () => {
          const session = ctx.sessions.current();
          return { key: session?.key, local: session?.server?.local === true, client: session?.server?.client };
        });
        restores.add(restore);
        report(restore.installed
          ? { installed: true, effectiveLimit: 5000, localSearchAvailable: !!localSearch && !!ctx.sessions.current()?.server?.local }
          : { installed: false, reason: "File search method cannot be wrapped" });
        onCleanup(() => { restore(); restores.delete(restore); });
      });
    }
    return () => {
      for (const restore of restores) restore();
      restores.clear();
      if (previous === null) root.removeAttribute(attribute);
      else root.setAttribute(attribute, previous);
    };
  },
});
