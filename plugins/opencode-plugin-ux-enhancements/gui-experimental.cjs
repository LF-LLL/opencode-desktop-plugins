"use strict";
// Package name: opencode-plugin-ux-enhancements. Legacy IDs are kept for migration.

const { Plugin, Style, Ipc, createKeyed } = require("@opencode/plugin/gui");
const { Schema } = require("effect");
const { createSignal, createEffect, onCleanup, getOwner, runWithOwner } = require("solid-js");
const { render } = require("solid-js/web");
const EditorIpc = Ipc.define({
  id: "desktop-workflow.editor",
  methods: { save: {
    input: Schema.Struct({ path: Schema.String, original: Schema.String, content: Schema.String }),
    output: Schema.Struct({ ok: Schema.Boolean, message: Schema.String }),
  } },
});

// Layout selectors were checked against Desktop 2.2.6. No stored widths are changed.
const css = `
[data-pane-row][data-workflow-focus] > [data-slot="session-chat-panel"] { display: none; }
[data-pane-row][data-workflow-focus] > [data-slot="session-side-panel-presence"] { flex: 1 1 100%; min-width: 0; }
[data-pane-row][data-workflow-focus] [data-slot="session-side-panel-content"],
[data-pane-row][data-workflow-focus] [data-slot="session-review-content"] { width: 100% !important; max-width: none !important; }
/* Halve the Markdown page gutters, including the old centered 768px column. */
[data-pane-row][data-workflow-focus] [data-slot="artifact-document-stage"][data-kind="markdown"] { container-type: inline-size; }
[data-pane-row][data-workflow-focus] [data-slot="artifact-markdown-page"] { padding-inline: clamp(12px, 6.25%, 67px); }
[data-pane-row][data-workflow-focus] [data-slot="artifact-markdown-content"] { max-width: calc(50cqw + 384px); }
[data-workflow-button] { border: 1px solid var(--v2-border-border-base); border-radius: 5px; background: var(--v2-background-bg-base); color: var(--v2-text-text-accent); padding: 3px 8px; white-space: nowrap; cursor: pointer; font: inherit; font-size: 12px; }
[data-workflow-button]:focus-visible, [data-workflow-file]:focus-visible { outline: 2px solid var(--v2-border-border-focus); outline-offset: 2px; }
[data-workflow-activity] { display: block; }
[data-workflow-summary] { display: block; width: 100%; box-sizing: border-box; color: var(--v2-text-text-muted); font-size: 12px; line-height: 1.6; margin: 3px 0 5px; overflow-wrap: anywhere; }
[data-workflow-summary][data-status="running"] { color: var(--v2-text-text-accent); }
[data-workflow-summary][data-status="error"] { color: var(--v2-state-fg-danger); }
[data-workflow-file] { color: var(--v2-text-text-code-path); text-decoration: underline; text-underline-offset: 2px; cursor: pointer !important; }
[data-workflow-code-toolbar] { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; position: sticky; top: 0; z-index: 5; padding: 8px 12px; background: var(--v2-background-bg-base); border-bottom: 1px solid var(--v2-border-border-base); font-size: 12px; }
[data-workflow-code-path] { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--v2-text-text-muted); user-select: text; }
[data-workflow-editor] { display: block; box-sizing: border-box; width: 100%; min-height: 55vh; resize: vertical; padding: 12px; border: 1px solid var(--v2-border-border-base); background: var(--v2-background-bg-base); color: var(--v2-text-text-base); font-family: var(--font-family-mono, monospace); font-size: 13px; line-height: 1.6; tab-size: 4; white-space: pre; }
[data-workflow-edit-status] { font-size: 12px; color: var(--v2-text-text-muted); }
`;

// Explicit Save is the only write path. Keep encoding/BOM and reject
// external changes, symlinks, binary data, and oversized text before writing.
async function readLimited(handle, limit) {
  const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1));
  const parts = [];
  let position = 0;
  while (position <= limit) {
    const length = Math.min(chunk.length, limit + 1 - position);
    const { bytesRead } = await handle.read(chunk, 0, length, position);
    if (bytesRead === 0) break;
    position += bytesRead;
    if (position > limit) return undefined;
    parts.push(Buffer.from(chunk.subarray(0, bytesRead)));
  }
  return Buffer.concat(parts, position);
}

async function writeAt(handle, bytes) {
  let written = 0;
  while (written < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, written, bytes.length - written, written);
    if (bytesWritten === 0) throw new Error("File write made no progress");
    written += bytesWritten;
  }
  await handle.truncate(bytes.length);
}

async function saveLocalText(input, fs, path, signal) {
  const limit = 2 * 1024 * 1024;
  if (!input || typeof input.path !== "string" || typeof input.original !== "string" || typeof input.content !== "string") {
    return { ok: false, message: "保存内容无效" };
  }
  if (Buffer.byteLength(input.original, "utf8") > limit * 2) return { ok: false, message: "编辑基线超出保存上限" };
  if (Buffer.byteLength(input.content, "utf8") > limit) return { ok: false, message: "编辑保存上限为 2 MB" };
  if (input.content.includes("\0")) return { ok: false, message: "二进制文件不能按文本保存" };
  if (Buffer.from(input.content, "utf8").toString("utf8") !== input.content) {
    return { ok: false, message: "文件编码不完整，未保存" };
  }
  if (!path.isAbsolute(input.path)) return { ok: false, message: "保存路径必须是本地绝对路径" };
  // UNC and device paths are not local text-file targets. Do not write network shares.
  if (/^[\\/]{2}/.test(input.path)) return { ok: false, message: "保存路径必须是本地绝对路径" };
  if (path.sep === "\\" && input.path.slice(2).includes(":")) {
    return { ok: false, message: "保存路径必须是本地绝对路径" }; // Reject NTFS alternate data streams.
  }
  if (signal?.aborted) return { ok: false, message: "保存已取消" };
  const pathStat = await fs.lstat(input.path);
  if (!pathStat.isFile()) return { ok: false, message: "仅支持保存普通文件，不跟随符号链接" };
  if (pathStat.size > limit) return { ok: false, message: "编辑保存上限为 2 MB" };
  // Keep one file handle open so path replacement cannot redirect the final write.
  const handle = await fs.open(input.path, "r+");
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino) {
      return { ok: false, message: "文件路径已变化或指向符号链接，未保存" };
    }
    if (openedStat.size > limit) return { ok: false, message: "编辑保存上限为 2 MB" };
    const bytes = await readLimited(handle, limit);
    if (!bytes) return { ok: false, message: "编辑保存上限为 2 MB" };
    let encoding = "utf8", bom = Buffer.alloc(0), body = bytes;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf16le"; bom = bytes.subarray(0, 2); body = bytes.subarray(2); }
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf16be"; bom = bytes.subarray(0, 2); body = bytes.subarray(2); }
    else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { bom = bytes.subarray(0, 3); body = bytes.subarray(3); }
    if (encoding !== "utf8" && body.length % 2) return { ok: false, message: "文件编码不完整，未保存" };
    const current = encoding === "utf16be" ? Buffer.from(body).swap16().toString("utf16le") : body.toString(encoding);
    if (encoding === "utf8" && !Buffer.from(current, "utf8").equals(body)) return { ok: false, message: "仅支持 UTF-8 或带 BOM 的 UTF-16 文本" };
    if (encoding !== "utf8") {
      const littleEndian = encoding === "utf16be" ? Buffer.from(body).swap16() : body;
      if (!Buffer.from(current, "utf16le").equals(littleEndian)) return { ok: false, message: "UTF-16 文本编码不完整，未保存" };
    }
    if (current.includes("\0")) return { ok: false, message: "二进制文件不能按文本保存" };
    if (current !== input.original.replace(/^\uFEFF/, "")) return { ok: false, message: "文件已被外部修改，未覆盖；编辑内容已保留" };
    let text = input.content.replace(/^\uFEFF/, "");
    // Textareas normalize to LF. Preserve uniform CRLF when saving Windows files.
    if (current.includes("\r\n") && !/(^|[^\r])\n/.test(current)) text = text.replace(/\r?\n/g, "\r\n");
    let next = Buffer.from(text, encoding === "utf8" ? "utf8" : "utf16le");
    if (encoding === "utf16be") next = next.swap16();
    if (bom.length + next.length > limit) return { ok: false, message: "编辑保存上限为 2 MB" };
    if (signal?.aborted) return { ok: false, message: "保存已取消" };
    const latest = await readLimited(handle, limit);
    if (!latest || !latest.equals(bytes)) return { ok: false, message: "文件已被外部修改，未覆盖；编辑内容已保留" };
    const latestPathStat = await fs.lstat(input.path);
    if (!latestPathStat.isFile() || latestPathStat.dev !== openedStat.dev || latestPathStat.ino !== openedStat.ino) {
      return { ok: false, message: "文件路径已变化或指向符号链接，未保存" };
    }
    await writeAt(handle, Buffer.concat([bom, next]));
    await handle.sync();
    return { ok: true, message: "已保存" };
  } finally {
    await handle.close();
  }
}

function getDiagnosticDirectory(localAppData, tempDirectory, userId, path) {
  if (typeof localAppData === "string" && localAppData.trim()) return path.join(localAppData, "Temp", "opencode");
  const userPart = Number.isInteger(userId) ? `opencode-${userId}` : "opencode-user";
  return path.join(tempDirectory, userPart);
}

// Redact common credential forms in added summaries. Original host content stays
// untouched; this is a presentation safeguard, not a comprehensive secret scanner.
function redactSummary(value) {
  return value
    .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [redacted]")
    .replace(/((?:--)?\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|token|secret)\b["']?\s*(?:[:=]\s*|\s+))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;"']+)/gi, "$1[redacted]");
}
const compact = (value, limit = 160) => typeof value === "string"
  ? redactSummary(value).replace(/\s+/g, " ").trim().slice(0, limit) : "";
// English is the fallback; the host selects the window's current language.
const english = {
  focus: "Toggle full-width side panel", wide: "Full width", restore: "Restore split view",
  "tool.read": "Read file", "tool.glob": "Find files", "tool.grep": "Search content", "tool.shell": "Shell",
  "tool.execute": "Run tools", "tool.patch": "Apply patch", "tool.skill": "Load skill", "tool.webfetch": "Read webpage",
  "tool.question": "Confirm question", "tool.subagent": "Subtask",
  "status.streaming": "Preparing", "status.running": "Running", "status.completed": "Completed", "status.error": "Failed",
  waitingCommand: "Waiting for command", runScript: "Run script ({count} lines)", runCommand: "Run command",
  codeMode: "Run Code Mode script", waitingCalls: "Waiting for call details", separator: "; ", total: "{count} items total",
  edit: "Edit", save: "Save", discard: "Discard changes", editCode: "Edit code", localEdit: "Only local files can be edited",
  unsaved: "Unsaved", restored: "Restored unsaved changes", editing: "Editing", localSave: "Only local files can be saved; changes retained",
  saving: "Saving…", refreshing: "Saved; refreshing…", refreshFailed: "Saved; refresh failed. Reopen the file",
  incomplete: "Save did not finish; changes retained", discarded: "Changes discarded",
  copyContent: "Copy contents", copyPath: "Copy path", copied: "{label} (copied)", copyFailed: "{label} (failed)",
  actionFailed: "Action failed", more: "More", download: "Download", reveal: "Show in file manager", openWith: "Open with",
  noEditors: "No supported editor detected", otherEditor: "Choose another editor…", pickEditor: "Choose an editor to view code",
  "保存内容无效": "Invalid save content", "编辑基线超出保存上限": "Edit baseline exceeds the save limit",
  "编辑保存上限为 2 MB": "The save limit is 2 MB", "保存路径必须是本地绝对路径": "Save path must be a local absolute path",
  "保存已取消": "Save cancelled", "仅支持保存普通文件，不跟随符号链接": "Only regular files can be saved; symbolic links are not followed",
  "文件路径已变化或指向符号链接，未保存": "File path changed or points to a symbolic link; not saved",
  "文件编码不完整，未保存": "Incomplete file encoding; not saved", "仅支持 UTF-8 或带 BOM 的 UTF-16 文本": "Only UTF-8 or UTF-16 text with a BOM is supported",
  "UTF-16 文本编码不完整，未保存": "Incomplete UTF-16 encoding; not saved", "二进制文件不能按文本保存": "Binary files cannot be saved as text",
  "文件已被外部修改，未覆盖；编辑内容已保留": "File changed externally; not overwritten. Your edits were retained",
  "已保存": "Saved", "此文件正在保存，请稍后重试": "This file is being saved; try again shortly",
  "保存失败，请检查文件权限；编辑内容已保留": "Save failed. Check file permissions; your edits were retained",
};
const chinese = {
  focus: "切换右侧面板全宽", wide: "全宽", restore: "恢复分栏",
  "tool.read": "读取文件", "tool.glob": "查找文件", "tool.grep": "搜索内容", "tool.shell": "Shell",
  "tool.execute": "执行工具", "tool.patch": "应用补丁", "tool.skill": "加载技能", "tool.webfetch": "读取网页",
  "tool.question": "确认问题", "tool.subagent": "子任务",
  "status.streaming": "准备中", "status.running": "执行中", "status.completed": "已完成", "status.error": "失败",
  waitingCommand: "等待命令参数", runScript: "运行脚本（{count} 行）", runCommand: "运行命令",
  codeMode: "运行 Code Mode 脚本", waitingCalls: "等待调用信息", separator: "；", total: "共 {count} 项",
  edit: "编辑", save: "保存", discard: "放弃修改", editCode: "编辑代码", localEdit: "仅支持编辑本地文件",
  unsaved: "未保存", restored: "已恢复未保存的编辑", editing: "编辑中", localSave: "仅支持保存本地文件，编辑内容已保留",
  saving: "保存中…", refreshing: "已保存，正在刷新…", refreshFailed: "已保存；刷新失败，请重新打开文件",
  incomplete: "保存未完成，编辑内容已保留", discarded: "已放弃修改",
  copyContent: "复制全文", copyPath: "复制路径", copied: "{label}（已复制）", copyFailed: "{label}（失败）",
  actionFailed: "操作失败", more: "更多", download: "下载", reveal: "在文件资源管理器中显示", openWith: "打开方式",
  noEditors: "未检测到支持的编辑器", otherEditor: "选择其他编辑器…", pickEditor: "选择用于查看代码的编辑器",
};
// Existing IPC messages are stable keys, translated only in the receiving window.
for (const key of Object.keys(english)) if (!(key in chinese)) chinese[key] = key;
function englishText(key, params = {}) {
  return (english[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}
function translatedText(t, key, params) {
  return key in english ? t(key, params) : key;
}

function inputOf(tool) {
  if (typeof tool?.state?.input !== "string") return tool?.state?.input || {};
  try { const value = JSON.parse(tool.state.input); return value && typeof value === "object" ? value : {}; } catch { return {}; }
}

function shellSummary(command, t = englishText) {
  if (typeof command !== "string") return t("waitingCommand");
  const lines = command.trim().split(/\r?\n/);
  const first = lines.find(line => line.trim() && !/^\s*(?:@['"]|['"]@|#)/.test(line)) || lines[0];
  return `${lines.length > 1 ? t("runScript", { count: lines.length }) : t("runCommand")} · ${compact(first)}`;
}

function toolSummary(tool, t = englishText) {
  const input = inputOf(tool), metadata = tool.state?.metadata || {};
  let status = tool.state?.status || "running";
  const calls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls.filter(call => call && typeof call.tool === "string") : [];
  if (status === "completed" && (metadata.error === true || metadata.timeout === true
    || (tool.name === "shell" && typeof metadata.exit === "number" && metadata.exit !== 0)
    || calls.some(call => call.status === "error"))) status = "error";
  let detail;
  if (tool.name === "shell") detail = shellSummary(input.command, t);
  else if (tool.name === "execute") {
    detail = calls.length ? calls.slice(-3).map(call => {
      const args = call.input || {};
      const target = args.query || args.url || args.pattern;
      return `${call.tool}${target ? ` · ${compact(target, 90)}` : ""}`;
    }).join(t("separator")) : `${t("codeMode")} · ${compact(input.code, 110) || t("waitingCalls")}`;
  } else detail = compact(input.description || input.pattern || input.query || input.url || input.id || input.name);
  return { status, text: `${`status.${status}` in english ? t(`status.${status}`) : status} · ${`tool.${tool.name}` in english ? t(`tool.${tool.name}`) : tool.name}${detail ? ` · ${detail}` : ""}` };
}

// Recognize file references, not arbitrary URLs, glob patterns, or shell switches.
function fileCandidateMatches(text) {
  const pattern = /file:\/\/\/(?:[A-Za-z]:\/)?[^\s<>"'`|]+|[A-Za-z]:[\\/][^\r\n<>"'`|]+?\.[A-Za-z0-9]{1,12}(?=[:\s,;，。)\]}]|$)|(?:\.{1,3}[\\/]|\/)?(?:[\w@.\-]+[\\/])+[\w@.\-]+\.[A-Za-z0-9]{1,12}(?=[:\s,;，。)\]}"'`]|$)|\b[\w@\-][\w@.\-]*\.(?:md|jsonc?|[cm]?js|tsx?|py|ps1|yaml|yml|xml|txt|csv|java|sql|log)\b/g;
  const source = String(text || "").slice(0, 100000);
  const result = [];
  for (const match of source.matchAll(pattern)) {
    if (match.index > 0 && /[\w/\\:*?]/.test(source[match.index - 1])) continue;
    let display = match[0].replace(/[),;，。\]}]+$/, "");
    let line = display.match(/:\d+(?::\d+)?(?:-\d+)?(?:,\d+(?:-\d+)?)?$/)?.[0] || "";
    if (line) display = display.slice(0, display.length - line.length);
    else line = source.slice(match.index + display.length).match(/^:\d+(?::\d+)?(?:-\d+)?(?:,\d+(?:-\d+)?)*/)?.[0] || "";
    let path = display;
    if (/^file:\/\//i.test(path)) {
      try { path = decodeURIComponent(path.replace(/^file:\/\/\//i, "")); } catch { continue; }
      if (!/^[A-Za-z]:\//.test(path)) path = `/${path}`;
    }
    path = path.replaceAll("\\", "/");
    if (path.includes("://") || /[*?]/.test(path)) continue;
    const marker = path.match(/\/(?:\.{3}|…)\//)?.[0];
    const shortened = !!marker || path.startsWith(".../") || path.startsWith("…/");
    if (marker) path = path.slice(path.lastIndexOf(marker) + marker.length);
    else if (path.startsWith(".../")) path = path.slice(4);
    else if (path.startsWith("…/")) path = path.slice(2);
    result.push({ path, shortened, start: match.index, end: match.index + display.length + line.length });
    if (result.length === 48) break;
  }
  return result;
}

function fileCandidates(text) {
  const result = [];
  for (const { path } of fileCandidateMatches(text)) {
    if (!result.includes(path)) result.push(path);
    if (result.length === 24) break;
  }
  return result;
}

function resolveReference(reference, base) {
  if (!base || /^(?:[A-Za-z]:\/|\/\/|\/)/.test(reference)) return reference;
  const combined = `${base.replaceAll("\\", "/").replace(/\/$/, "")}/${reference}`;
  const parts = [];
  for (const part of combined.split("/")) {
    if (part === ".") continue;
    if (part === ".." && parts.length > 1) parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveTreeFileSuffix(reference, doc) {
  const suffix = reference.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  if (!suffix || !doc?.querySelectorAll) return;
  const matches = Array.from(doc.querySelectorAll('[data-slot="session-review-v2-sidebar-tree"] [data-item-type="file"][data-item-path]'))
    .map(row => row.getAttribute("data-item-path"))
    .filter(path => {
      const normalized = String(path || "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
      return normalized === suffix || normalized.endsWith(`/${suffix}`);
    });
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : unique.length ? null : undefined;
}

// Add link behavior to the host's existing label without changing its text,
// children, dimensions, or ownership. Restore only attributes still ours.
function installInlineFileLink(element, path, session, ctx) {
  const changed = new Map();
  for (const [name, value] of [["data-workflow-file", ""], ["role", "link"], ["tabindex", "0"], ["title", path]]) {
    changed.set(name, { original: element.getAttribute(name), value });
    element.setAttribute(name, value);
  }
  const open = event => {
    if (event.type === "keydown" && event.key !== "Enter") return;
    if (event.type === "click" && (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (ctx.sessions.current()?.key !== session.key) return;
    ctx.links.open({ href: path, session, exact: true });
  };
  element.addEventListener("click", open, true);
  element.addEventListener("keydown", open, true);
  return () => {
    element.removeEventListener("click", open, true);
    element.removeEventListener("keydown", open, true);
    for (const [name, { original, value }] of changed) if (element.getAttribute(name) === value) {
      if (original === null) element.removeAttribute(name);
      else element.setAttribute(name, original);
    }
  };
}

function inlineFileTarget(element, tools, session) {
  if (element.closest('a, pre') || element.getAttribute("role") === "button") return;
  if (element.matches('[data-slot="read-tool-group-file"], [data-slot="basic-tool-tool-subtitle"]')) {
    const owner = element.closest('[data-timeline-part-id]');
    const tool = tools.get(owner?.getAttribute("data-timeline-part-id"));
    const input = inputOf(tool);
    if (!["read", "edit", "write"].includes(tool?.name) || typeof input.path !== "string") return;
    return resolveReference(input.path.replaceAll("\\", "/"), resolveReference(input.workdir || session.directory, session.directory));
  }
  // Only a complete inline-code file reference, never a shell command or a
  // fenced code sample. Leave native Markdown links alone.
  const text = element.textContent.trim();
  const candidates = fileCandidateMatches(text);
  if (candidates.length !== 1 || candidates[0].start !== 0 || candidates[0].end !== text.length) return;
  let reference = candidates[0].path;
  if (candidates[0].shortened) {
    const treePath = resolveTreeFileSuffix(reference, document);
    if (treePath === null) return;
    reference = treePath || reference;
  }
  return resolveReference(reference, session.directory);
}

// A fenced block is linkified only when it is a plain list of absolute paths.
// Mixed prose, commands, source code, relative paths, and unknown languages stay untouched.
function fencedFileList(element) {
  const pre = element.closest?.("pre");
  if (!pre || pre.querySelector?.("code") !== element || pre.querySelector?.("a")) return;
  const classes = (element.getAttribute?.("class") || element.className || "").split(/\s+/).filter(Boolean);
  const language = classes.map(value => value.match(/^language-(.+)$/i)?.[1]?.toLowerCase()).find(Boolean);
  if (language && !["text", "plaintext", "txt", "path", "paths"].includes(language)) return;

  const rawLines = String(element.textContent || "").split("\n");
  const entries = [];
  let pathCount = 0;
  for (let index = 0; index < rawLines.length; index++) {
    const raw = rawLines[index];
    const hasNewline = index < rawLines.length - 1;
    const hasCarriageReturn = raw.endsWith("\r");
    const line = hasCarriageReturn ? raw.slice(0, -1) : raw;
    const lineEnding = hasNewline ? (hasCarriageReturn ? "\r\n" : "\n") : (hasCarriageReturn ? "\r" : "");
    if (!line.trim()) {
      entries.push({ text: line + lineEnding });
      continue;
    }
    const display = line.trim();
    const candidates = fileCandidates(display);
    if (candidates.length !== 1) return;
    const path = candidates[0];
    const normalized = display.replaceAll("\\", "/").replace(/:\d+(?::\d+)?$/, "");
    if (!/^file:\/\//i.test(display) && normalized !== path) return;
    if (!/^(?:[A-Za-z]:\/|\/{1,2})/.test(path)) return;
    entries.push({
      path,
      prefix: line.slice(0, line.length - line.trimStart().length),
      display,
      suffix: line.slice(line.trimEnd().length),
      lineEnding,
    });
    pathCount++;
  }
  return pathCount >= 2 ? entries : undefined;
}

function installFencedFileLinks(element, entries, existing, session, ctx) {
  const originalNodes = Array.from(element.childNodes);
  const fragment = document.createDocumentFragment();
  const disposeLinks = [];
  const appendText = text => { if (text) fragment.appendChild(document.createTextNode(text)); };
  entries.forEach((entry, index) => {
    if (entry.text !== undefined) {
      appendText(entry.text);
      return;
    }
    appendText(entry.prefix);
    if (existing[index]) {
      const link = document.createElement("a");
      link.textContent = entry.display;
      disposeLinks.push(installInlineFileLink(link, entry.path, session, ctx));
      fragment.appendChild(link);
    } else appendText(entry.display);
    appendText(entry.suffix + entry.lineEnding);
  });
  const renderedNodes = Array.from(fragment.childNodes);
  element.replaceChildren(fragment);
  return {
    renderedNodes,
    dispose() {
      for (const dispose of disposeLinks) dispose();
      if (element.isConnected && element.childNodes.length === renderedNodes.length
          && renderedNodes.every((node, index) => element.childNodes[index] === node)) {
        element.replaceChildren(...originalNodes);
      }
    },
  };
}


function presentationMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  return {
    exit: metadata.exit, error: metadata.error, timeout: metadata.timeout,
    toolCalls: Array.isArray(metadata.toolCalls) ? metadata.toolCalls.filter(call => call && typeof call.tool === "string").map(call => ({
      tool: call.tool, status: call.status,
      input: { query: call.input?.query, url: call.input?.url, pattern: call.input?.pattern },
    })) : [],
  };
}

function snapshotTools(messages) {
  const result = new Map();
  if (!Array.isArray(messages)) return result;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.type === "shell") result.set(message.id, { id: message.id, name: "shell", state: { status: message.status, input: { command: message.command }, metadata: { exit: message.exit } } });
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part?.type !== "tool" || typeof part.id !== "string") continue;
      // Keep only what presentation needs. Never retain duplicate tool output.
      result.set(part.id, { id: part.id, name: part.name, state: {
        status: part.state?.status, input: part.state?.input, metadata: presentationMetadata(part.state?.metadata),
      } });
    }
  }
  return result;
}

// Open each native context group once, using its real trigger/state. A later
// manual collapse must survive scans, streamed tools, and virtualized remounts.
function defaultExpandToolGroup(element, seen, sessionKey) {
  const first = element.getAttribute("data-timeline-part-ids")?.split(",")[0];
  if (!first) return false;
  const key = `${sessionKey}\n${first}`;
  if (seen.has(key)) return false;
  const trigger = element.querySelector(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]');
  const expanded = trigger?.getAttribute("aria-expanded");
  if (expanded !== "true" && expanded !== "false") return false;
  seen.add(key);
  if (expanded === "false") trigger.click();
  return expanded === "false";
}

function applyToolEvent(tools, event) {
  if (typeof event?.type !== "string" || !event.data || typeof event.data.id !== "string") return;
  event = { ...event.data, type: event.type };
  if (!event.type.startsWith("session.tool.")) return;
  const old = tools.get(event.id) || { id: event.id, name: event.name || "tool", state: { status: "streaming", input: "" } };
  const state = { ...old.state };
  if (event.type === "session.tool.input.started") { old.name = event.name; state.status = "streaming"; state.input = ""; }
  if (event.type === "session.tool.input.delta") state.input = (typeof state.input === "string" ? state.input : "") + event.delta;
  if (event.type === "session.tool.input.ended") state.input = event.text;
  if (event.type === "session.tool.called") { state.status = "running"; state.input = event.input; }
  if (event.type === "session.tool.progress") state.metadata = presentationMetadata(event.metadata);
  if (event.type === "session.tool.success" || event.type === "session.tool.failed") {
    state.status = event.type.endsWith("failed") ? "error" : "completed";
    state.metadata = event.metadata ? presentationMetadata(event.metadata) : state.metadata;
    // Output stays in the host; only input and presentation metadata are needed here.
  }
  tools.set(event.id, { ...old, state });
}

// Match only native file tabs. Review/diff views and message code blocks stay untouched.
function filePreviewInfo(viewer, ctx, doc) {
  if (!viewer?.matches?.('[data-component="file"][data-mode="text"]')
    || !viewer.closest('[data-slot="session-review-v2-preview"]')) return;
  const panel = viewer.closest('[role="tabpanel"]');
  const tab = doc.getElementById(panel?.getAttribute("aria-labelledby") || "");
  let key = tab?.getAttribute("data-pane-tab") || tab?.closest?.('[data-pane-tab]')?.getAttribute("data-pane-tab");
  // Native grouped file panels can omit aria-labelledby. Read the selected tab
  // from this pane instead; do not assume every panel has a labelled trigger.
  if (!key) {
    const pane = viewer.closest('[data-slot="session-side-pane"]') || doc;
    const selected = Array.from(pane.querySelectorAll?.('[data-pane-tab]') || []).find(node => node.querySelector?.('[aria-selected="true"], [data-selected]'));
    key = selected?.getAttribute("data-pane-tab");
  }
  if (!key?.startsWith("file://")) return;
  const session = ctx.sessions.current(), screen = ctx.screen?.current();
  if (!session || !screen) return;
  const path = screen.file.resolve(key);
  const content = screen.file.get(path)?.content;
  if (!content || content.type === "binary" || typeof content.content !== "string") return;
  return { session, screen, path, absolute: resolveReference(path, session.directory) };
}

function normalizeTreePath(value) {
  if (typeof value !== "string") return "";
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function revealFileInTree(viewer, info) {
  const review = viewer.closest?.('[data-component="session-review-v2"]');
  const tree = review?.querySelector?.('[data-slot="session-review-v2-sidebar-tree"]');
  if (!tree) return "pending";

  const root = normalizeTreePath(info.screen?.file.root || info.session.directory).replace(/\/$/, "");
  const absolute = normalizeTreePath(info.absolute);
  let relative = normalizeTreePath(info.path);
  if (/^[A-Za-z]:\//.test(relative) || relative.startsWith("/")) {
    const normalizedRoot = /^[A-Za-z]:\//.test(root) ? root.toLowerCase() : root;
    const normalizedPath = /^[A-Za-z]:\//.test(relative) ? relative.toLowerCase() : relative;
    const prefix = `${normalizedRoot}/`;
    relative = normalizedPath.startsWith(prefix.toLowerCase())
      ? relative.slice(prefix.length) : relative.replace(/^\/+/, "");
  }
  const parts = relative.split("/").filter(Boolean);
  const windowsPath = /^[A-Za-z]:\//.test(absolute);
  const equalPath = (left, right) => windowsPath
    ? normalizeTreePath(left).toLowerCase() === normalizeTreePath(right).toLowerCase()
    : normalizeTreePath(left) === normalizeTreePath(right);
  const candidates = (path) => {
    const values = [path];
    if (root && path) values.push(`${root.replace(/\/$/, "")}/${path}`);
    return values;
  };
  const rows = () => {
    const roots = [tree, ...Array.from(tree.querySelectorAll?.("file-tree-container") || []).map(host => host.shadowRoot).filter(Boolean)];
    return roots.flatMap(root => Array.from(root.querySelectorAll?.("[data-item-path]") || []));
  };
  const findRow = (paths, type) => rows().find(row => {
    const rowPath = row.getAttribute("data-item-path");
    return (type === undefined || row.getAttribute("data-item-type") === type)
      && paths.some(path => equalPath(rowPath, path));
  });

  // Expand one ancestor at a time because deeper rows appear after their parent opens.
  for (let index = 1; index < parts.length; index++) {
    const parent = parts.slice(0, index).join("/");
    const folder = findRow(candidates(parent), "folder");
    if (!folder) return "pending";
    if (folder.getAttribute("aria-expanded") !== "true") {
      if (folder.getAttribute("aria-expanded") === "false") {
        folder.scrollIntoView?.({ block: "nearest" });
        folder.click?.();
      }
      return "pending";
    }
  }

  const file = findRow(candidates(parts.join("/")), "file");
  if (!file) return "pending";
  file.scrollIntoView?.({ block: "nearest" });
  if (file.getAttribute("data-item-selected") !== "true" && file.getAttribute("aria-selected") !== "true") {
    file.click?.();
  }
  return "done";
}

function collapseCompletedToolGroup(element, seen, tools, sessionKey, answered, finished) {
  const ids = element.getAttribute('data-timeline-part-ids')?.split(',').filter(Boolean) || [];
  if (!ids.length || (!answered && !finished)) return false;
  const known = ids.map(id => tools.get(id)).filter(Boolean);
  if (!finished && known.some(tool => !['completed', 'error'].includes(tool.state?.status))) return false;
  // Wait for tool state before collapsing a live group. Historical groups may
  // no longer be present in the server context after compaction.
  if (!finished && known.length === 0) return false;
  const key = `${sessionKey}\n${ids.join(',')}`;
  if (seen.has(key)) return false;
  const trigger = element.querySelector(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]');
  const expanded = trigger?.getAttribute('aria-expanded');
  if (expanded !== 'true' && expanded !== 'false') return false;
  seen.add(key);
  if (expanded === 'true') trigger.click();
  return expanded === 'true';
}

function activeFileTreeInfo(ctx, doc) {
  const session = ctx.sessions.current(), screen = ctx.screen?.current();
  if (!session || typeof screen?.file?.resolve !== "function" || typeof screen.file.get !== "function") return;
  const tab = Array.from(doc.querySelectorAll('[data-pane-tab]')).find(node =>
    node.getClientRects().length && node.querySelector('[aria-selected="true"], [data-selected]')
    && node.getAttribute('data-pane-tab')?.startsWith('file://'));
  if (!tab) return;
  const path = screen.file.resolve(tab.getAttribute('data-pane-tab'));
  return { session, screen, path, absolute: resolveReference(path, screen.file.root || session.directory) };
}

// Use the host's file-tree state, not clicks on virtualized directory rows.
// Loading each parent makes descendants available even when they are off screen.
async function expandFileParents(info, isCurrent) {
  const files = info.screen.file;
  const root = normalizeTreePath(files.root || info.session.directory);
  let relative = normalizeTreePath(info.path);
  const insensitive = /^[A-Za-z]:\//.test(root);
  const equal = (left, right) => insensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (/^[A-Za-z]:\//.test(relative) || relative.startsWith('/')) {
    if (!equal(relative.slice(0, root.length + 1), `${root}/`)) return false;
    relative = relative.slice(root.length + 1);
  }
  const parts = relative.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..')) return false;
  if (!isCurrent()) return false;
  await files.tree.sync('');
  for (let index = 1; index < parts.length; index++) {
    if (!isCurrent()) return false;
    const parent = parts.slice(0, index).join('/');
    files.tree.expand(parent);
    await files.tree.sync(parent);
  }
  return isCurrent();
}

function blockFileCommentGesture(event, ctx, doc) {
  if (event.button !== 0) return false;
  const path = event.composedPath();
  // Keep search fields and any existing comment controls usable.
  if (path.some(node => /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName || ""))) return false;
  if (path.some(node => node.matches?.('[data-component="line-comment-v2"], [data-comment-id]'))) return false;
  const viewer = path.find(node => node.matches?.('[data-component="file"][data-mode="text"]'));
  if (!filePreviewInfo(viewer, ctx, doc)) return false;
  const code = path.some(node => node.matches?.('diffs-container, [data-code], [data-line], [data-line-number], [data-gutter]'));
  if (!code) return false;
  // Stop OpenCode/Pierre's comment gesture, not the browser's text selection.
  event.stopImmediatePropagation();
  return true;
}

module.exports = Plugin.define({
  i18n: { en: english, zh: chinese },
  async main(ctx) {
    const fs = require("node:fs/promises");
    const path = require("node:path");
    const saving = new Set();
    ctx.provide(EditorIpc, { save: async (input, caller) => {
      const resolved = path.resolve(input.path);
      const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
      if (saving.has(key)) return { ok: false, message: "此文件正在保存，请稍后重试" };
      saving.add(key);
      try { return await saveLocalText(input, fs, path, caller?.signal); }
      catch { return { ok: false, message: "保存失败，请检查文件权限；编辑内容已保留" }; }
      finally { saving.delete(key); }
    } });
    // Normal startup only provides the editor IPC. Diagnostics and UI probes
    // are maintenance tools, never implicit permission to inspect a workspace.
    if (ctx.options?.diagnostics !== true) return;
    const { BrowserWindow } = require("electron");
    const os = require("node:os");
    const diagnosticPath = getDiagnosticDirectory(process.env.LOCALAPPDATA, os.tmpdir(),
      typeof process.getuid === "function" ? process.getuid() : undefined, path);
    // Return immediately; the host flags slow main setups as stalled.
    const timer = setTimeout(async () => {
    try {
    await fs.mkdir(diagnosticPath, { recursive: true, mode: 0o700 });
    const consumeFlag = async name => {
      const flag = path.join(diagnosticPath, name);
      try { await fs.access(flag); await fs.unlink(flag); return true; }
      catch { return false; }
    };
    // Runtime interaction checks require a one-shot flag and stay dormant on normal startup.
    const developerChecks = ctx.options?.developerChecks === true;
    const testFocus = developerChecks && await consumeFlag("desktop-workflow-check-once.flag");
    const testCode = developerChecks && await consumeFlag("desktop-workflow-code-check.flag");
    const testEditor = developerChecks && await consumeFlag("desktop-workflow-editor-check.flag");
    const codeTestPath = path.join(__dirname, "test.cjs").replaceAll("\\", "/");
    const codeTestPathLiteral = JSON.stringify(codeTestPath);
    const codeTestSuffixLiteral = JSON.stringify(`/${path.basename(__dirname)}/test.cjs`);
    const windows = [];
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      let codeWasFull;
      if (testCode) codeWasFull = await window.webContents.executeJavaScript(`(async () => {
        const wasFull = document.documentElement.getAttribute('data-workflow-side-open') === 'true';
        document.dispatchEvent(new CustomEvent('desktop-workflow-open-code-test', { detail: ${codeTestPathLiteral} }));
        await new Promise(resolve => requestAnimationFrame(resolve));
        const button = document.querySelector('[data-slot="session-review-toggle"] button');
        if (document.documentElement.getAttribute('data-workflow-side-open') === 'true') button?.click();
        button?.click();
        for (let attempt = 0; attempt < 120; attempt++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const viewer = document.querySelector('[data-workflow-readonly]');
          const root = viewer?.querySelector('diffs-container')?.shadowRoot;
          if (viewer?.previousElementSibling?.querySelector('[data-workflow-code-path]')?.title?.replaceAll(String.fromCharCode(92), '/').endsWith(${codeTestSuffixLiteral}) && (root?.querySelectorAll('[data-code] [data-line]').length || 0) >= 5) break;
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return wasFull;
      })()`);
      let codeCheck;
      if (testCode) {
        const target = await window.webContents.executeJavaScript(`(() => {
          const viewer = document.querySelector('[data-workflow-readonly]');
          if (!viewer || !viewer.previousElementSibling?.querySelector('[data-workflow-code-path]')?.title?.replaceAll(String.fromCharCode(92), '/').endsWith(${codeTestSuffixLiteral})) return { skipped: true, reason: 'Test file is not ready' };
          const root = viewer.querySelector('diffs-container')?.shadowRoot;
          if (!root) return { skipped: true, reason: 'No code shadow root' };
          const drafts = [...viewer.querySelectorAll('textarea'), ...root.querySelectorAll('textarea')];
          if (drafts.some(input => input.value.trim())) return { skipped: true, reason: 'Non-empty comment draft' };
          for (const input of drafts) {
            const form = input.closest('[data-component="line-comment-v2"]');
            Array.from(form?.querySelectorAll('button') || []).find(button => /^(Cancel|取消)$/.test(button.textContent.trim()))?.click();
          }
          const lines = Array.from(root.querySelectorAll('[data-line]')).filter(element => {
            const rect = element.getBoundingClientRect();
            return element.closest('[data-code]') && rect.width > 100 && rect.top > 80 && rect.bottom < innerHeight - 20;
          });
          if (lines.length < 5) return { skipped: true, reason: 'Not enough visible code lines' };
          const first = lines[1].getBoundingClientRect(), last = lines[4].getBoundingClientRect();
          return { x1: first.left + 8, y1: (first.top + first.bottom) / 2, x2: last.left + Math.min(180, last.width / 2), y2: (last.top + last.bottom) / 2 };
        })()`);
        if (target.skipped) codeCheck = target;
        else {
          const zoom = window.webContents.getZoomFactor();
          const point = (x, y) => ({ x: Math.round(x * zoom), y: Math.round(y * zoom) });
          window.webContents.sendInputEvent({ type: "mouseMove", ...point(target.x1, target.y1) });
          window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point(target.x1, target.y1) });
          for (let step = 1; step <= 8; step++) window.webContents.sendInputEvent({ type: "mouseMove", modifiers: ["leftButtonDown"], ...point(target.x1 + (target.x2 - target.x1) * step / 8, target.y1 + (target.y2 - target.y1) * step / 8) });
          window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point(target.x2, target.y2) });
          codeCheck = await window.webContents.executeJavaScript(`(async () => {
            for (let frame = 0; frame < 8; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
            const viewer = document.querySelector('[data-workflow-readonly]');
            const root = viewer?.querySelector('diffs-container')?.shadowRoot;
            const selection = root?.getSelection?.() || window.getSelection();
            const selectedCharacters = selection?.toString().length || 0;
            const commentForms = (viewer?.querySelectorAll('textarea').length || 0) + (root?.querySelectorAll('textarea').length || 0);
            selection?.removeAllRanges();
            return { trustedMouse: true, selectedCharacters, commentForms, passed: selectedCharacters > 0 && commentForms === 0 };
          })()`);
        }
      }
      let editorCheck;
      if (testEditor) {
        const sample = path.join(diagnosticPath, `desktop-workflow-editor-test-${Date.now()}-${window.id}.py`);
        let sampleCreated = false;
        try {
        await fs.writeFile(sample, "value = 1\n", { flag: "wx" });
        sampleCreated = true;
        const target = JSON.stringify(sample.replaceAll("\\", "/"));
        const opened = await window.webContents.executeJavaScript(`(async () => {
          const prior = Array.from(document.querySelectorAll('[data-pane-tab]')).find(tab => tab.getAttribute('data-pane-tab')?.startsWith('file://') && tab.querySelector('[data-selected], [aria-selected="true"]'))?.getAttribute('data-pane-tab');
          const wasOpen = document.documentElement.getAttribute('data-workflow-side-open') === 'true';
          document.dispatchEvent(new CustomEvent('desktop-workflow-open-editor-test', { detail: ${target} }));
          for (let frame = 0; frame < 180; frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            const toolbar = Array.from(document.querySelectorAll('[data-workflow-code-toolbar]')).find(toolbar => toolbar.querySelector('[data-workflow-code-path]')?.title === ${target});
            if (toolbar) {
              const button = document.querySelector('[data-slot="session-review-toggle"] button');
              if (!document.querySelector('[data-workflow-focus]')) { if (document.documentElement.getAttribute('data-workflow-side-open') === 'true') button?.click(); button?.click(); }
              toolbar.querySelector('[data-workflow-edit-action="edit"]').click();
              const editor = document.querySelector('[data-workflow-editor]');
              if (!editor) return { skipped: true, reason: 'Editor unavailable', prior, wasOpen };
              editor.value = 'value = 2\\n'; editor.dispatchEvent(new Event('input', { bubbles: true })); editor.focus();
              return { prior, wasOpen };
            }
          }
          return { skipped: true, reason: 'Sample file did not load', prior, wasOpen };
        })()`);
        if (opened.skipped) editorCheck = opened;
        else {
          await window.webContents.executeJavaScript(`(async () => {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const toolbar = Array.from(document.querySelectorAll('[data-workflow-code-toolbar]')).find(toolbar => toolbar.querySelector('[data-workflow-code-path]')?.title === ${target});
            const editor = toolbar?.nextElementSibling;
            if (editor?.matches('[data-workflow-editor]')) { editor.focus(); editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); }
          })()`);
          const savedUi = await window.webContents.executeJavaScript(`(async () => {
            for (let frame = 0; frame < 240; frame++) {
              await new Promise(resolve => requestAnimationFrame(resolve));
              const status = Array.from(document.querySelectorAll('[data-workflow-edit-status]')).find(status => /^(Saved|已保存)$/.test(status.textContent));
              if (status && !document.querySelector('[data-workflow-editor]')) return true;
            }
            return false;
          })()`);
          const savedDisk = await fs.readFile(sample, "utf8") === "value = 2\n";
          if (savedUi && savedDisk) {
            await window.webContents.executeJavaScript(`(() => {
              const toolbar = Array.from(document.querySelectorAll('[data-workflow-code-toolbar]')).find(toolbar => toolbar.querySelector('[data-workflow-code-path]')?.title === ${target});
              toolbar.querySelector('[data-workflow-edit-action="edit"]').click();
              const editor = document.querySelector('[data-workflow-editor]'); editor.value = 'value = 3\\n'; editor.dispatchEvent(new Event('input', { bubbles: true })); editor.focus();
            })()`);
            await fs.writeFile(sample, "external = 1\n");
            await window.webContents.executeJavaScript(`(() => {
              const toolbar = Array.from(document.querySelectorAll('[data-workflow-code-toolbar]')).find(toolbar => toolbar.querySelector('[data-workflow-code-path]')?.title === ${target});
              const editor = toolbar?.nextElementSibling;
              if (editor?.matches('[data-workflow-editor]')) { editor.focus(); editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); }
            })()`);
            const protectedUi = await window.webContents.executeJavaScript(`(async () => {
              for (let frame = 0; frame < 240; frame++) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                if (Array.from(document.querySelectorAll('[data-workflow-edit-status]')).some(status => /外部修改|changed externally/.test(status.textContent))) return document.querySelector('[data-workflow-editor]')?.value === 'value = 3\\n';
              }
              return false;
            })()`);
            const protectedDisk = await fs.readFile(sample, "utf8") === "external = 1\n";
            editorCheck = { savedUi, savedDisk, protectedUi, protectedDisk, passed: savedUi && savedDisk && protectedUi && protectedDisk };
          } else editorCheck = { savedUi, savedDisk, passed: false };
        }
        await window.webContents.executeJavaScript(`(() => {
          const toolbar = Array.from(document.querySelectorAll('[data-workflow-code-toolbar]')).find(toolbar => toolbar.querySelector('[data-workflow-code-path]')?.title === ${target});
          toolbar?.querySelector('[data-workflow-edit-action="discard"]')?.click();
          if (${JSON.stringify(opened.prior || null)}) document.dispatchEvent(new CustomEvent('desktop-workflow-open-editor-test', { detail: ${JSON.stringify(opened.prior || "")} }));
          if ((document.documentElement.getAttribute('data-workflow-side-open') === 'true') !== ${JSON.stringify(opened.wasOpen)}) document.querySelector('[data-slot="session-review-toggle"] button')?.click();
        })()`);
        } finally {
          if (sampleCreated) {
            try { await fs.unlink(sample); } catch { /* Best-effort cleanup of the test-only file. */ }
          }
        }
      }
      let focusCheck;
      if (testFocus) focusCheck = await window.webContents.executeJavaScript(`(async () => {
        const button = document.querySelector('[data-slot="session-review-toggle"] button');
        const row = document.querySelector('[data-pane-row]:has([data-slot="session-side-panel-presence"])');
        const activeRow = row || button?.closest('[data-pane-row]');
        if (!button || !activeRow) return { skipped: true, reason: 'No review button' };
        const opened = () => document.documentElement.getAttribute('data-workflow-side-open') === 'true';
        const read = () => ({ opened: opened(), full: activeRow.hasAttribute('data-workflow-focus'), row: activeRow.getBoundingClientRect().width, chat: activeRow.querySelector('[data-slot="session-chat-panel"]')?.getBoundingClientRect().width || 0, side: activeRow.querySelector('[data-slot="session-side-panel-presence"]')?.getBoundingClientRect().width || 0 });
        const settle = async target => {
          for (let frame = 0; frame < 120; frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            const value = read();
            if (value.opened === target && value.full === target && (target ? value.chat < 2 && Math.abs(value.side - value.row) < 2 : value.side < 2 && Math.abs(value.chat - value.row) < 2)) return value;
          }
          return read();
        };
        const wasOpen = opened();
        if (wasOpen) { button.click(); await settle(false); }
        try {
          button.click(); const full = await settle(true);
          button.click(); const hidden = await settle(false);
          return { full, hidden, passed: full.opened && full.full && full.chat < 2 && Math.abs(full.side - full.row) < 2 && !hidden.opened && !hidden.full && hidden.side < 2 && Math.abs(hidden.chat - hidden.row) < 2 };
        } finally { if (opened() !== wasOpen) { button.click(); await settle(wasOpen); } }
      })()`);
      let keyCheck, menuCheck;
      if (testFocus && !focusCheck?.skipped) {
        const key = () => {
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "R", modifiers: ["control", "shift"] });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "R", modifiers: ["control", "shift"] });
        };
        const focused = () => window.webContents.executeJavaScript(`(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return { opened: document.documentElement.getAttribute('data-workflow-side-open') === 'true', full: !!document.querySelector('[data-workflow-focus]') }; })()`);
        const original = await focused();
        key(); const afterFirst = await focused();
        key(); const afterSecond = await focused();
        keyCheck = { binding: "Ctrl+Shift+R", original, afterFirst, afterSecond, passed: afterFirst.opened !== original.opened && afterSecond.opened === original.opened && afterFirst.full === afterFirst.opened && afterSecond.full === afterSecond.opened };
      }
      if (testCode) {
        const menuPoint = await window.webContents.executeJavaScript(`(() => {
          const rect = document.querySelector('[data-workflow-code-more] button')?.getBoundingClientRect();
          return rect && rect.width > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
        })()`);
        if (menuPoint) {
          const zoom = window.webContents.getZoomFactor();
          const point = { x: Math.round(menuPoint.x * zoom), y: Math.round(menuPoint.y * zoom) };
          window.webContents.sendInputEvent({ type: "mouseMove", ...point });
          window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
          window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
        }
        menuCheck = await window.webContents.executeJavaScript(`(async () => {
          const button = document.querySelector('[data-workflow-code-more] button');
          if (!button) return { skipped: true, reason: 'No code actions menu' };
          for (let frame = 0; frame < 4; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
          const menus = Array.from(document.querySelectorAll('[role="menu"], [data-component="menu-v2-content"]')).filter(menu => menu.getClientRects().length);
          const labels = menus.flatMap(menu => Array.from(menu.querySelectorAll('[role="menuitem"], [data-component="menu-v2-item"]'), item => item.textContent.trim()));
          const text = menus.map(menu => menu.textContent).join(' ');
          const editorsSection = /打开方式|Open with/.test(text);
          return { labels, editorsSection, passed: [['下载', 'Download'], ['在文件资源管理器中显示', 'Show in file manager'], ['复制路径', 'Copy path']].every(choices => choices.some(label => labels.includes(label))) && editorsSection };
        })()`);
        window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
        await window.webContents.executeJavaScript(`(() => {
          if ((document.documentElement.getAttribute('data-workflow-side-open') === 'true') !== ${JSON.stringify(codeWasFull)}) document.querySelector('[data-slot="session-review-toggle"] button')?.click();
        })()`);
      }
      const result = await window.webContents.executeJavaScript(`(() => ({
        installed: document.documentElement.getAttribute('data-desktop-workflow'),
        buttons: document.querySelectorAll('[data-slot="session-review-toggle"] button').length,
        summaries: document.querySelectorAll('[data-workflow-summary]').length,
        summaryLayout: Array.from(document.querySelectorAll('[data-workflow-summary]')).filter(summary => summary.getClientRects().length).map(summary => {
          const native = summary.previousElementSibling;
          const own = summary.getBoundingClientRect(), before = native?.getBoundingClientRect();
          return { stacked: !!before && own.top >= before.bottom - 1, block: getComputedStyle(summary.parentElement).display === 'block' };
        }),
        fileLinks: document.querySelectorAll('[data-workflow-file]').length,
        inlineLinks: document.querySelectorAll('[data-workflow-file][role="link"]').length,
        activityFileRows: document.querySelectorAll('[data-workflow-files]').length,
        activityGroups: Array.from(document.querySelectorAll('[data-component="collapsed-tool-group"]')).map(group => ({
          expanded: group.querySelector(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')?.getAttribute('aria-expanded'),
        })),
        readonlyCodePreviews: document.querySelectorAll('[data-workflow-readonly]').length,
        nativeCodePreviews: document.querySelectorAll('[data-slot="session-review-v2-preview"] [data-component="file"][data-mode="text"]').length,
        codeCopyButtons: document.querySelectorAll('[data-workflow-copy]').length,
        codeMenus: document.querySelectorAll('[data-workflow-code-more]').length,
        editorActions: document.querySelectorAll('[data-workflow-edit-action]').length,
        sideOpened: document.documentElement.getAttribute('data-workflow-side-open'),
        treeFollow: document.documentElement.getAttribute('data-workflow-tree-follow'),
        treeRows: Array.from(document.querySelectorAll('file-tree-container')).flatMap(host =>
          Array.from(host.shadowRoot?.querySelectorAll('[data-item-path]') || []).filter(row =>
            row.getAttribute('aria-expanded') === 'true' || row.getAttribute('aria-selected') === 'true'
          ).map(row => ({ path: row.getAttribute('data-item-path'),
            expanded: row.getAttribute('aria-expanded'), selected: row.getAttribute('aria-selected') }))),
        toolRows: document.querySelectorAll('[data-component="tool-part-wrapper"]').length,
        reasoningRows: document.querySelectorAll('[data-component="reasoning-part"]').length,
        knownTools: Number(document.documentElement.getAttribute('data-workflow-tool-count') || 0),
        snapshot: document.documentElement.getAttribute('data-workflow-snapshot'),
        errorCards: document.querySelectorAll('[data-kind="session-error-card"]').length,
        markdownSpacing: (() => {
          const fixture = document.createElement('div');
          fixture.setAttribute('data-pane-row', '');
          fixture.setAttribute('aria-hidden', 'true');
          fixture.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;';
          fixture.innerHTML = '<div data-slot="artifact-document-stage" data-kind="markdown" data-document-surface-column data-document-surface-scrollport><div data-slot="artifact-markdown-page" data-component="document-surface"><div data-slot="artifact-markdown-content"></div></div></div>';
          document.body.appendChild(fixture);
          try {
            const page = fixture.querySelector('[data-slot="artifact-markdown-page"]');
            const content = fixture.querySelector('[data-slot="artifact-markdown-content"]');
            const gap = () => content.getBoundingClientRect().left - page.getBoundingClientRect().left;
            return [1024, 1520, 1920].map(width => {
              fixture.style.width = width + 'px';
              fixture.removeAttribute('data-workflow-focus');
              const before = gap();
              fixture.setAttribute('data-workflow-focus', '');
              const after = gap();
              return { width, before, after, passed: before > 20 && Math.abs(after - before / 2) < 2 };
            });
          } finally { fixture.remove(); }
        })(),
        focused: document.querySelectorAll('[data-workflow-focus]').length
      }))()`);
      if (focusCheck) result.focusCheck = focusCheck;
      if (codeCheck) result.codeCheck = codeCheck;
      if (keyCheck) result.keyCheck = keyCheck;
      if (menuCheck) result.menuCheck = menuCheck;
      if (editorCheck) result.editorCheck = editorCheck;
      windows.push(result);
    }
    try {
      await fs.writeFile(path.join(diagnosticPath, "desktop-workflow-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), windows }, null, 2));
    } catch {
      // Runtime diagnostics are optional and must not affect plugin behavior.
    }
    } catch {
      // The one-shot diagnostics may race with window shutdown or temp cleanup.
    }
    }, 6000);
    return () => clearTimeout(timer);
  },
  setup(ctx) {
    // Decline incompatible host APIs before adding listeners or changing layout.
    if (typeof ctx.sessions?.current !== "function" || typeof createKeyed !== "function"
      || typeof ctx.layout?.narrow !== "function" || typeof ctx.layout?.side?.opened !== "function"
      || typeof ctx.layout?.side?.toggle !== "function") return;
    const t = (key, params) => ctx.t(key, params);
    const localizedNodes = new Map();
    const localize = (node, key, params) => {
      const read = () => t(key, typeof params === "function" ? params() : params);
      localizedNodes.set(node, read);
      node.textContent = read();
    };
    const root = document.documentElement;
    const owner = getOwner();
    const previous = root.getAttribute("data-desktop-workflow");
    root.setAttribute("data-desktop-workflow", "installed");
    const [focused, setFocused] = createSignal(false);
    const [codeEpoch, setCodeEpoch] = createSignal(0);
    let focusRow, activeSession, tools = new Map(), stopped = false, timer;
    const decorated = new Map(), codePreviews = new Map(), expandedGroups = new Set(), collapsedGroups = new Set();
    let executionFinished = false;
    const inlineLinks = new Map(), fencedFileLists = new Map(), linkChecks = new Map();
    let linkQueue = [], linkWorking = 0;
    let editorIpc;
    try { editorIpc = ctx.main?.(EditorIpc); } catch { /* Keep read-only previews when the editor bridge is unavailable. */ }
    // Window-local only: drafts survive tab switches and plugin hot reloads,
    // but are never written to storage or sent to a model.
    const fallbackDrafts = { drafts: {} };
    const [drafts, mutateDrafts] = ctx.storage?.memory("editor-drafts", { initial: { drafts: {} } })
      || [fallbackDrafts, fn => fn(fallbackDrafts)];
    const controllers = new Set();
    let followedFile, treeFollowGeneration = 0;
    const followActiveFile = () => {
      const info = activeFileTreeInfo(ctx, document);
      const key = info && `${info.session.key}\n${info.absolute}`;
      if (key === followedFile) return;
      followedFile = key;
      const generation = ++treeFollowGeneration;
      if (!info || !info.screen.file.tree?.sync) return;
      const isCurrent = () => !stopped && generation === treeFollowGeneration
        && ctx.sessions.current()?.key === info.session.key;
      void expandFileParents(info, isCurrent).then(done => {
        if (done) root.setAttribute('data-workflow-tree-follow', 'parents-expanded');
      }).catch(() => {
        if (isCurrent()) {
          followedFile = undefined;
          root.setAttribute('data-workflow-tree-follow', 'failed');
        }
      });
    };
    const maxLinkChecks = 512;
    const [editors, setEditors] = createSignal([]);
    // Use the same Windows editor identifiers as the native Open in menu.
    // Do not offer an OS default opener: a .py or .ps1 association can execute it.
    if (ctx.desktop?.os === "windows" && typeof ctx.desktop.installed === "function") {
      const apps = [{ label: "Visual Studio Code", app: "code" }, { label: "Cursor", app: "cursor" }, { label: "Zed", app: "zed" }];
      void Promise.all(apps.map(async item => await ctx.desktop.installed(item.app).catch(() => false) ? item : null))
        .then(items => { if (!stopped) setEditors(items.filter(Boolean)); });
    }

    const blockComment = event => blockFileCommentGesture(event, ctx, document);
    for (const type of ["pointerdown", "mousedown", "click"]) document.addEventListener(type, blockComment, true);
    const openCodeTest = event => {
      const session = ctx.sessions.current();
      const target = event.detail;
      if (session && typeof target === "string" && (target.startsWith("/") || /^[A-Za-z]:[\\/]/.test(target))) {
        ctx.links.open({ href: target, session, exact: true });
      }
    };
    if (ctx.options?.developerChecks === true) document.addEventListener("desktop-workflow-open-code-test", openCodeTest);
    const openEditorTest = event => {
      const session = ctx.sessions.current();
      const target = event.detail;
      if (session && typeof target === "string" && (/^file:\/\//.test(target) || /^[A-Za-z]:[\\/]/.test(target) || target.startsWith("/"))) {
        ctx.links.open({ href: target, session, exact: true });
      }
    };
    if (ctx.options?.developerChecks === true) document.addEventListener("desktop-workflow-open-editor-test", openEditorTest);
    const removeCodePreview = (viewer, value) => {
      for (const node of localizedNodes.keys()) if (value.toolbar.contains(node)) localizedNodes.delete(node);
      value.dispose?.();
      value.editor?.remove();
      if (value.originalDisplay !== undefined) viewer.style.display = value.originalDisplay;
      value.toolbar.remove();
      viewer.removeAttribute("data-workflow-readonly");
      codePreviews.delete(viewer);
    };
    const syncCodePreviews = () => {
      for (const [viewer, value] of codePreviews) {
        const info = viewer.isConnected && filePreviewInfo(viewer, ctx, document);
        if (!info || info.session.key !== value.sessionKey || info.path !== value.path) removeCodePreview(viewer, value);
        else {
          if (value.size) {
            const bytes = new TextEncoder().encode(info.screen.file.get(info.path).content.content).byteLength;
            const text = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
            if (value.size.textContent !== text) value.size.textContent = text;
          }
        }
      }
      for (const viewer of document.querySelectorAll('[data-component="file"][data-mode="text"]')) {
        if (!viewer.getClientRects().length || codePreviews.has(viewer)) continue;
        const info = filePreviewInfo(viewer, ctx, document);
        if (!info) continue;
        const toolbar = document.createElement("div");
        toolbar.setAttribute("data-workflow-code-toolbar", "");
        const label = document.createElement("span");
        label.setAttribute("data-workflow-code-path", "");
        label.textContent = info.absolute;
        label.title = info.absolute;
        toolbar.appendChild(label);
        const size = document.createElement("span");
        const bytes = new TextEncoder().encode(info.screen.file.get(info.path).content.content).byteLength;
        size.textContent = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
        toolbar.appendChild(size);
        const value = { toolbar, size, path: info.path, sessionKey: info.session.key, editing: false, treeRevealDone: false };
        const draftKey = `${info.session.key}\n${info.absolute}`;
        const status = document.createElement("span");
        status.setAttribute("data-workflow-edit-status", "");
        toolbar.appendChild(status);
        const edit = document.createElement("button"), save = document.createElement("button"), discard = document.createElement("button");
        for (const [button, name] of [[edit, "edit"], [save, "save"], [discard, "discard"]]) {
          button.type = "button"; localize(button, name);
          button.setAttribute("data-workflow-button", name);
          button.setAttribute("data-workflow-edit-action", name);
          toolbar.appendChild(button);
        }
        edit.disabled = typeof editorIpc?.save !== "function" || !info.session.server.local
          || typeof info.screen.file.sync !== "function";
        save.hidden = true; discard.hidden = true;
        const finishEditing = message => {
          value.editor?.remove(); value.editor = undefined; value.editing = false;
          if (value.originalDisplay !== undefined) viewer.style.display = value.originalDisplay;
          save.hidden = true; discard.hidden = true; edit.hidden = false;
          localize(status, message);
        };
        value.enterEdit = () => {
          if (value.editing || value.saving || edit.disabled) return;
          const current = filePreviewInfo(viewer, ctx, document);
          if (!current || current.path !== value.path || current.session.key !== value.sessionKey) return;
          if (!current.session.server.local) { localize(status, "localEdit"); return; }
          const text = current.screen.file.get(current.path).content.content;
          const cached = drafts.drafts[draftKey];
          value.base = cached?.base ?? text;
          value.editor = document.createElement("textarea");
          value.editor.setAttribute("data-workflow-editor", "");
          value.editor.setAttribute("aria-label", t("editCode"));
          value.editor.spellcheck = false; value.editor.wrap = "off";
          value.editor.value = cached?.text ?? text;
          value.editor.addEventListener("input", () => {
            mutateDrafts(state => { state.drafts[draftKey] = { base: value.base, text: value.editor.value }; });
            localize(status, "unsaved");
          });
          value.originalDisplay = viewer.style.display;
          viewer.style.display = "none";
          viewer.before(value.editor);
          value.editing = true; edit.hidden = true; save.hidden = false; discard.hidden = false;
          localize(status, cached ? "restored" : "editing");
          value.editor.focus();
        };
        value.save = async () => {
          if (!value.editing || value.saving) return;
          const current = filePreviewInfo(viewer, ctx, document);
          if (!current || current.path !== value.path || current.session.key !== value.sessionKey) return;
          if (!current.session.server.local) { localize(status, "localSave"); return; }
          const content = value.editor.value;
          mutateDrafts(state => { state.drafts[draftKey] = { base: value.base, text: content }; });
          value.saving = true; save.disabled = true; discard.disabled = true; value.editor.readOnly = true; localize(status, "saving");
          let savedOnDisk = false;
          try {
            const result = await editorIpc.save({ path: current.absolute, original: value.base, content });
            if (!result.ok) { localize(status, result.message in english ? result.message : "incomplete"); return; }
            savedOnDisk = true;
            mutateDrafts(state => { delete state.drafts[draftKey]; });
            finishEditing("refreshing");
            await current.screen.file.sync(current.path, { force: true });
            localize(status, "已保存");
          } catch { localize(status, savedOnDisk ? "refreshFailed" : "incomplete"); }
          finally { value.saving = false; save.disabled = false; discard.disabled = false; if (value.editor) value.editor.readOnly = false; }
        };
        edit.addEventListener("click", value.enterEdit);
        save.addEventListener("click", () => void value.save());
        discard.addEventListener("click", () => {
          mutateDrafts(state => { delete state.drafts[draftKey]; }); finishEditing("discarded");
        });
        for (const [kind, title] of [["content", "copyContent"], ["path", "copyPath"]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("data-workflow-button", "copy");
          button.setAttribute("data-workflow-copy", kind);
          button.disabled = typeof ctx.system?.copy !== "function";
          localize(button, title);
          button.addEventListener("click", async () => {
            const current = filePreviewInfo(viewer, ctx, document);
            if (!current || current.session.key !== value.sessionKey || current.path !== value.path) return;
            const text = kind === "path" ? current.absolute : value.editing ? value.editor.value : current.screen.file.get(current.path)?.content?.content;
            if (typeof text !== "string") return;
            try { await ctx.system.copy(text); localize(button, "copied", () => ({ label: t(title) })); }
            catch { localize(button, "copyFailed", () => ({ label: t(title) })); }
          });
          toolbar.appendChild(button);
        }
        const more = document.createElement("span");
        more.setAttribute("data-workflow-code-more", "");
        toolbar.appendChild(more);
        const action = async (kind, app) => {
          const current = filePreviewInfo(viewer, ctx, document);
          if (!current || current.session.key !== value.sessionKey || current.path !== value.path) return;
          const content = value.editing ? value.editor.value : current.screen.file.get(current.path)?.content?.content;
          try {
            if (kind === "download" && typeof content === "string") await ctx.system.save({ name: current.path.split(/[\\/]/).at(-1), content });
            if (kind === "path") await ctx.system.copy(current.absolute);
            if (kind === "reveal") await ctx.desktop.reveal(current.absolute);
            if (kind === "editor") await ctx.desktop.launch(current.absolute, app);
          } catch { label.title = `${current.absolute} · ${t("actionFailed")}`; }
        };
        if (typeof ctx.ui?.Menu === "function") value.dispose = runWithOwner(owner, () => render(() => ctx.ui.Menu({
          get label() { return t("more"); }, trigger: "button", placement: "bottom-end",
          get items() { return [
            { label: t("download"), disabled: typeof ctx.system?.save !== "function", onSelect: () => void action("download") },
            { label: t("reveal"), disabled: typeof ctx.desktop?.reveal !== "function" || !info.session.server.local, onSelect: () => void action("reveal") },
            { label: t("copyPath"), disabled: typeof ctx.system?.copy !== "function", onSelect: () => void action("path") },
            { type: "group", label: t("openWith"), items: [
              ...(editors().length ? editors().map(item => ({ label: item.label, disabled: !info.session.server.local || typeof ctx.desktop?.launch !== "function", onSelect: () => void action("editor", item.app) })) : [{ label: t("noEditors"), disabled: true, onSelect() {} }]),
              { label: t("otherEditor"), disabled: typeof ctx.desktop?.pick !== "function" || typeof ctx.desktop?.launch !== "function" || !info.session.server.local, onSelect: () => {
                void ctx.desktop.pick({ title: t("pickEditor"), extensions: ctx.desktop.os === "windows" ? ["exe"] : undefined })
                  .then(files => { if (files[0]) return action("editor", files[0]); }, () => {});
              } },
            ] },
          ]; },
        }), more));
        else more.hidden = true;
        viewer.setAttribute("data-workflow-readonly", "");
        viewer.before(toolbar);
        codePreviews.set(viewer, value);
        const cached = drafts.drafts[draftKey];
        if (cached && cached.text.replace(/\r\n/g, "\n") === info.screen.file.get(info.path).content.content.replace(/\r\n/g, "\n")) {
          mutateDrafts(state => { delete state.drafts[draftKey]; }); localize(status, "已保存");
        } else if (cached) value.enterEdit();
      }
    };
    // File loads and shadow-root redraws need not mutate the outer document.
    // Track file load completion reactively as well as the DOM's selected tab.
    createEffect(() => {
      codeEpoch();
      ctx.screen?.current()?.file?.ready?.();
      followActiveFile();
      syncCodePreviews();
    });

    const clearFocus = () => {
      focusRow?.removeAttribute("data-workflow-focus");
      focusRow = undefined;
    };
    const updateFocus = () => {
      const session = ctx.sessions.current();
      if (!focused() || !session || !ctx.layout.side.opened(session) || ctx.layout.narrow()) { clearFocus(); return; }
      const row = Array.from(document.querySelectorAll('[data-slot="session-chat-panel"]')).find(element => element.getClientRects().length || element.parentElement.hasAttribute("data-workflow-focus"))?.parentElement;
      if (!row?.hasAttribute("data-pane-row")) return;
      if (focusRow !== row) clearFocus();
      focusRow = row;
      row.setAttribute("data-workflow-focus", "");
    };
    const toggleFocus = () => {
      const session = ctx.sessions.current();
      if (!session || ctx.layout.narrow() || typeof ctx.layout.side.toggle !== "function") return false;
      if (ctx.layout.side.opened(session)) {
        setFocused(false);
        clearFocus();
        ctx.layout.side.toggle(session);
      } else {
        ctx.layout.side.toggle(session);
        setFocused(true);
        updateFocus();
      }
    };
    createEffect(() => {
      const session = ctx.sessions.current();
      root.setAttribute("data-workflow-side-open", String(!!session && ctx.layout.side.opened(session)));
      if (!session || !ctx.layout.side.opened(session) || ctx.layout.narrow()) setFocused(false);
      updateFocus();
    });

    ctx.add(Style, css);
    // The native review.toggle shortcut is Ctrl+Shift+R on Windows.
    // Its host listener captures at document, so intercept at window first.
    const reviewKey = event => {
      const modifier = ctx.desktop?.os === "macos" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!modifier || !event.shiftKey || event.altKey || String(event.key).toLowerCase() !== "r"
        || event.isComposing || !ctx.sessions.current() || ctx.layout.narrow()) return;
      if (Array.from(document.querySelectorAll('[data-component="dialog-v2"], [role="dialog"][aria-modal="true"]')).some(dialog => dialog.getClientRects().length)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) toggleFocus();
    };
    window.addEventListener("keydown", reviewKey, true);
    const saveKey = event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || String(event.key).toLowerCase() !== "s") return;
      const value = Array.from(codePreviews.values()).find(value => value.editing
        && value.editor?.getClientRects().length && value.sessionKey === ctx.sessions.current()?.key
        && (event.composedPath().includes(value.editor) || value.editor === document.activeElement || value.toolbar.contains(document.activeElement))
        && ctx.layout.side.opened(ctx.sessions.current()));
      if (!value) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) void value.save();
    };
    window.addEventListener("keydown", saveKey, true);
    // Reuse the original Review toggle. Leave its native icon and tooltip intact.
    const reviewClick = event => {
      const button = event.composedPath().find(node => node.tagName === "BUTTON"
        && node.closest?.('[data-slot="session-review-toggle"]'));
      if (!button || !ctx.sessions.current() || ctx.layout.narrow()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleFocus();
    };
    document.addEventListener("click", reviewClick, true);

    const removeDecorations = () => {
      for (const [element, value] of decorated) { value.summary?.remove(); element.removeAttribute("data-workflow-activity"); }
      decorated.clear();
      for (const value of inlineLinks.values()) value.dispose?.();
      inlineLinks.clear(); linkChecks.clear();
      for (const value of fencedFileLists.values()) value.dispose?.();
      fencedFileLists.clear();
      for (const task of linkQueue) task.resolve(false);
      linkQueue = [];
    };
    const pumpLinks = () => {
      while (!stopped && linkWorking < 4 && linkQueue.length) {
        const task = linkQueue.shift(); linkWorking++;
        Promise.resolve().then(task.run).then(task.resolve, () => task.resolve(false))
          .finally(() => { linkWorking--; pumpLinks(); });
      }
    };
    const fileExists = (path, session) => {
      const key = `${session.key}\n${path}`, cached = linkChecks.get(key);
      if (cached && Date.now() - cached.at < 30000) return cached.value;
      if (linkQueue.length + linkWorking >= maxLinkChecks) return Promise.resolve(false);
      const value = new Promise(resolve => {
        linkQueue.push({ resolve, run: () => !stopped && activeSession?.key === session.key && typeof ctx.links?.exists === "function"
          && typeof ctx.links?.open === "function" ? ctx.links.exists({ href: path, session }) : false });
        pumpLinks();
      });
      if (linkChecks.size >= 512) linkChecks.delete(linkChecks.keys().next().value);
      linkChecks.set(key, { at: Date.now(), value });
      return value;
    };
    const syncFencedFileLinks = session => {
      for (const [element, value] of fencedFileLists) {
        const renderedChanged = value.renderedNodes && (element.childNodes.length !== value.renderedNodes.length
          || !value.renderedNodes.every((node, index) => element.childNodes[index] === node));
        if (!element.isConnected || element.textContent !== value.text
            || value.sessionKey !== session.key || renderedChanged) {
          value.dispose?.(); fencedFileLists.delete(element);
        }
      }
      for (const element of document.querySelectorAll('[data-component="text-part"] pre code')) {
        if (fencedFileLists.has(element) || !element.getClientRects().length
            || getComputedStyle(element).visibility === "hidden") continue;
        const entries = fencedFileList(element);
        if (!entries) continue;
        const value = { text: element.textContent, sessionKey: session.key };
        fencedFileLists.set(element, value);
        void Promise.all(entries.map(entry => entry.path ? fileExists(entry.path, session) : false)).then(existing => {
          if (stopped || ctx.sessions.current()?.visit !== session.visit || !element.isConnected
              || fencedFileLists.get(element) !== value || element.textContent !== value.text) return;
          if (!existing.some(Boolean)) return;
          try {
            const installed = installFencedFileLinks(element, entries, existing, session, ctx);
            value.renderedNodes = installed.renderedNodes;
            value.dispose = installed.dispose;
          } catch {
            fencedFileLists.delete(element);
          }
        });
      }
    };
    const syncInlineLinks = session => {
      for (const [element, value] of inlineLinks) {
        const path = element.isConnected && inlineFileTarget(element, tools, session);
        if (path !== value.path || element.textContent !== value.text || value.sessionKey !== session.key) {
          value.dispose?.(); inlineLinks.delete(element);
        }
      }
      const labels = document.querySelectorAll('[data-slot="read-tool-group-file"][data-timeline-part-id], [data-component="tool-part-wrapper"] [data-slot="basic-tool-tool-subtitle"], [data-component="text-part"] code');
      for (const element of labels) {
        if (inlineLinks.has(element) || !element.getClientRects().length || getComputedStyle(element).visibility === "hidden" || element.closest('a, pre')) continue;
        const path = inlineFileTarget(element, tools, session);
        if (!path) continue;
        const value = { path, text: element.textContent, sessionKey: session.key };
        inlineLinks.set(element, value);
        void fileExists(path, session).then(found => {
          if (stopped || ctx.sessions.current()?.visit !== session.visit || !element.isConnected || inlineLinks.get(element) !== value || element.textContent !== value.text) return;
          if (found) value.dispose = installInlineFileLink(element, path, session, ctx);
          else value.missing = true;
        });
      }
    };
    const schedule = () => { if (!stopped && !timer) timer = setTimeout(() => { timer = undefined; scan(); }, 200); };
    const scan = () => {
      for (const [node, read] of localizedNodes) {
        if (!node.isConnected) { localizedNodes.delete(node); continue; }
        const text = read();
        if (node.textContent !== text) node.textContent = text;
      }
      for (const value of codePreviews.values()) value.editor?.setAttribute("aria-label", t("editCode"));
      updateFocus();
      setCodeEpoch(value => value + 1);
      const session = ctx.sessions.current();
      if (!session || session.key !== activeSession?.key) return;
      syncInlineLinks(session);
      syncFencedFileLinks(session);
      for (const [element, value] of decorated) {
        if (!element.isConnected) { value.summary?.remove(); element.removeAttribute("data-workflow-activity"); decorated.delete(element); }
      }
      const answers = Array.from(document.querySelectorAll('[data-component="text-part"]')).filter(part =>
        part.getClientRects().length && part.textContent.trim());
      for (const group of document.querySelectorAll('[data-component="collapsed-tool-group"]')) {
        if (!group.getClientRects().length || getComputedStyle(group).visibility === "hidden") continue;
        defaultExpandToolGroup(group, expandedGroups, session.key);
        const answered = answers.some(part => !group.contains(part) && (group.compareDocumentPosition(part) & 4));
        collapseCompletedToolGroup(group, collapsedGroups, tools, session.key, answered, executionFinished);
      }
      const elements = document.querySelectorAll('[data-component="tool-part-wrapper"][data-timeline-part-id], [data-component="session-shell-message"]');
      for (const element of elements) {
        // A modal marks the still-visible transcript aria-hidden for accessibility.
        // Do not mistake that for a visually hidden/cached timeline.
        if (!element.getClientRects().length || getComputedStyle(element).visibility === "hidden") continue;
        const id = element.getAttribute("data-timeline-part-id");
        const groupIds = element.getAttribute("data-timeline-part-ids")?.split(",") || [];
        const rowTools = [id, ...groupIds].map(id => tools.get(id)).filter(Boolean);
        const tool = rowTools[0];
        let value = decorated.get(element);
        if (!value) { value = {}; decorated.set(element, value); }
        // The host owns its children. Add siblings to trigger rows, never rewrite source text.
        if (tool) {
          const info = toolSummary(tool, t);
          if (rowTools.length > 1) info.text = rowTools.slice(-3).map(item => toolSummary(item, t).text).join(t("separator")) + (rowTools.length > 3 ? `${t("separator")}${t("total", { count: rowTools.length })}` : "");
          if (!value.summary?.isConnected) {
            value.summary = document.createElement("div");
            value.summary.setAttribute("data-workflow-summary", "");
            element.setAttribute("data-workflow-activity", "");
            element.appendChild(value.summary);
          }
          if (value.summary.textContent !== info.text) value.summary.textContent = info.text;
          if (value.summary.dataset.status !== info.status) value.summary.dataset.status = info.status;
        }
      }
    };

    // A language switch updates existing summaries and labels without a new tool event.
    createEffect(() => { t("status.completed"); schedule(); });
    const observer = new MutationObserver(records => {
      if (records.every(record => {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        return target?.closest?.('[data-workflow-summary], [data-workflow-files], [data-workflow-button], [data-workflow-code-toolbar]')
          || (record.type === "attributes" && record.attributeName === "data-workflow-focus")
          || (record.type === "childList" && [...record.addedNodes, ...record.removedNodes].every(node => node.nodeType === 1 && node.matches?.('[data-workflow-summary], [data-workflow-files]')));
      })) return;
      schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-expanded", "aria-expanded", "aria-selected", "data-selected", "aria-labelledby", "data-pane-tab", "class"] });

    createKeyed(() => {
      const session = ctx.sessions.current();
      return session ? { key: session.key || session.id, client: session.server?.client, directory: session.directory, visit: session.visit } : undefined;
    }, () => {
      setFocused(false); clearFocus(); removeDecorations(); expandedGroups.clear(); collapsedGroups.clear(); tools = new Map();
      executionFinished = false;
      activeSession = ctx.sessions.current();
      root.setAttribute("data-workflow-tool-count", "0");
      const session = activeSession;
      if (!session) return;
      const client = session.server?.client;
      if (typeof client?.session?.context !== "function" || typeof client?.event?.subscribe !== "function") {
        root.setAttribute("data-desktop-workflow", "activity-api-unavailable");
        return;
      }
      const controller = new AbortController();
      controllers.add(controller);
      let live = true, loading = true, buffered = [];
      const isCurrent = () => live && !stopped && activeSession === session && ctx.sessions.current()?.id === session.id;
      const applyActivity = event => {
        if (event.type === 'session.execution.started' || event.type === 'session.tool.input.started') executionFinished = false;
        if (['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'].includes(event.type)) executionFinished = true;
        applyToolEvent(tools, event);
      };
      const receive = event => {
        if (!isCurrent() || event?.data?.sessionID !== session.id) return;
        if (loading) {
          buffered.push(event);
          if (buffered.length < 2048) return;
          // A slow/unavailable snapshot must not grow the event buffer forever.
          loading = false;
          for (const pending of buffered) applyActivity(pending);
          buffered = [];
          root.setAttribute("data-workflow-snapshot", "live-events-only");
          schedule();
          return;
        }
        applyActivity(event); schedule();
      };
      void (async () => {
        try {
          for await (const event of client.event.subscribe({ signal: controller.signal, types: ["session.execution.started", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted", "session.text.started", "session.text.ended", "session.tool.input.started", "session.tool.input.delta", "session.tool.input.ended", "session.tool.called", "session.tool.progress", "session.tool.success", "session.tool.failed"] })) receive(event);
        } catch {
          if (isCurrent() && !controller.signal.aborted) root.setAttribute("data-desktop-workflow", "activity-stream-unavailable");
        }
      })();
      void Promise.resolve().then(() => client.session.context({ sessionID: session.id }, { signal: controller.signal })).then(result => {
        if (!isCurrent() || !loading) return; // Do not replace newer live state with a late snapshot.
        // The Promise client's session.context unwraps the API data envelope.
        const messages = Array.isArray(result) ? result : result?.data;
        root.setAttribute("data-workflow-snapshot", JSON.stringify({ array: Array.isArray(messages), messages: messages?.length || 0 }));
        tools = snapshotTools(messages);
        root.setAttribute("data-workflow-tool-count", String(tools.size));
        // The snapshot may already contain streamed deltas. Only replay state replacements.
        for (const event of buffered) if (event.type !== "session.tool.input.delta") applyActivity(event);
        buffered = []; loading = false; schedule();
      }).catch(() => {
        if (!isCurrent() || !loading) return;
        loading = false; for (const event of buffered) applyActivity(event);
        buffered = []; root.setAttribute("data-desktop-workflow", "activity-snapshot-unavailable"); schedule();
      });
      onCleanup(() => { live = false; controller.abort(); controllers.delete(controller); buffered = []; });
      schedule();
    }, { equals: (a, b) => a.key === b.key && a.client === b.client && a.directory === b.directory && a.visit === b.visit,
       otherwise: () => { activeSession = undefined; setFocused(false); clearFocus(); removeDecorations(); tools.clear(); expandedGroups.clear(); collapsedGroups.clear(); },
    });

    return () => {
      stopped = true; clearTimeout(timer); observer.disconnect(); clearFocus(); removeDecorations();
      for (const type of ["pointerdown", "mousedown", "click"]) document.removeEventListener(type, blockComment, true);
      document.removeEventListener("desktop-workflow-open-code-test", openCodeTest);
      document.removeEventListener("desktop-workflow-open-editor-test", openEditorTest);
      document.removeEventListener("click", reviewClick, true);
      window.removeEventListener("keydown", reviewKey, true);
      window.removeEventListener("keydown", saveKey, true);
      for (const [viewer, value] of codePreviews) removeCodePreview(viewer, value);
      localizedNodes.clear();
      for (const controller of controllers) controller.abort();
      tools.clear(); expandedGroups.clear(); collapsedGroups.clear();
      treeFollowGeneration++;
      root.removeAttribute('data-workflow-tree-follow');
      root.removeAttribute("data-workflow-tool-count");
      root.removeAttribute("data-workflow-snapshot");
      root.removeAttribute("data-workflow-side-open");
      if (previous === null) root.removeAttribute("data-desktop-workflow");
      else root.setAttribute("data-desktop-workflow", previous);
    };
  },
});
