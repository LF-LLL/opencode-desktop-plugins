# Contributing and acceptance checks

## Development

Use Node.js 20 or newer. Run `npm test` from the repository root; no dependency installation is required. This runs package-entry checks, syntax checks, the three plugin regression suites, and filesystem/lifecycle integration tests. Tests do not start OpenCode or a model. File-write tests create and remove only their own temporary fixtures.

The GUI entries are self-contained CommonJS source. OpenCode evaluates each entry in both its window and main process, so keep Node/Electron operations inside `main` and DOM/Solid operations inside `setup`. Do not add a relative runtime import: the GUI host expects one file. A larger architectural change should introduce the official GUI bundler deliberately, rather than silently breaking the copy-folder installation.

The root package exists only for developer checks. The three plugin packages remain independently installable. There is no npm publication in this repository; `private: true` is intentional.

## Architecture and extension points

| Package | Responsibilities | Keep separate |
| --- | --- | --- |
| Fiori Horizon | Theme tokens, scoped light-mode CSS, theme identity | No search, session changes, or file editing |
| Workspace Navigation | Search matching/ranking, native-query adapter, name-only filesystem index | No file contents, theme changes, or file writes |
| UX Enhancements | Full-width reading, tool presentation, file links/tree follow, explicit text editing | No model hooks, background saves, or external network integrations |

Extend the pure helpers first and add regression cases before changing host adapters. Tests use dependency-injected filesystem objects and the same runtime source, not a second implementation. Host mocks verify contracts and behavior, but are not a substitute for Desktop interaction tests.

Preserve `fiori-horizon-light` and `desktop-workflow`, including their IPC, theme, and draft-storage namespaces. Renaming package folders does not authorize changing these identities.

## Compatibility and safe degradation

The existing Desktop interaction baseline is Windows / OpenCode Desktop 2.2.6. Offline tests on other Node versions or operating systems do **not** certify other Desktop versions.

- Prefer documented Theme, Style, IPC, file-tree, storage, and translation APIs.
- Search wrapping and DOM adaptations are compatibility boundaries, not official UI hooks. If their preconditions fail, leave native search/layout intact rather than guessing a new selector.
- Optional clipboard/editor/menu APIs may be absent. Hide or disable the affected action; keep read-only viewing available.
- Capture session scope before asynchronous search. Never supplement a remote query with this machine's files after a session switch.
- Abort and release subscriptions, queues, indexes, listeners, and owned attributes on cleanup. Never restore an old search method over a newer extension's wrapper.
- macOS uses Command for the full-width shortcut. Native editor discovery is still Windows-specific. macOS Desktop interaction remains unverified.

An SDK import or contract-breaking change can still prevent the plugin from loading. Capability guards cannot make an incompatible SDK compatible; disable the affected plugin and check the target version's documentation.

## Resource and data boundaries

- Search indexes file names only, skips child symlinks and common dependency/cache directories, and rechecks queued directory targets before traversal. It retains at most four completed root indexes for 15 seconds. Per scan: at most 150,000 files and 50,000 scheduled directories; at most 5,000 results. A cancelled/failed scan is not cached. Concurrent uncached callers scan independently so one caller's cancellation cannot invalidate another's results. One filesystem operation already in progress may finish before cancellation is observed.
- Large or changing workspaces may produce incomplete results. These limits are not a filesystem sandbox or a completeness guarantee. Gitignored names are intentionally included, so do not share results without reviewing them.
- Activity retains presentation inputs and selected metadata, not duplicate tool output. If the initial snapshot stalls, a 2,048-event buffer switches to live events; a late snapshot must not overwrite newer live state.
- Common credential forms are redacted in added summaries. This is best-effort display protection, not comprehensive secret detection. Host-owned content is unchanged.
- Text saves reject oversized/binary/malformed text, UNC/device/NTFS-stream paths, replaced file handles, and detected external changes. Writes use one handle and flush before reporting success. They remain in-place, non-atomic writes: a crash, disk failure, or racing external writer can still cause data loss. Use disposable copies for acceptance tests and version control for important files.
- Drafts are window-memory only. They survive tab switches/hot reloads but not window closure. Do not silently evict unsaved drafts.

## Diagnostics

Fiori and UX write no diagnostic files on normal startup. `options.diagnostics: true` explicitly enables local diagnostic snapshots; these may contain file-tree paths. This changes neither the model nor agent permissions. Do not share snapshots without reviewing them.

UX's legacy interactive maintenance probes require **both** `diagnostics: true` and `developerChecks: true`, plus a one-shot flag in the diagnostic directory. The test-only document events are registered only with `developerChecks: true`. Never enable these options in a public sample configuration or an everyday profile. The probes may open test files, simulate input, and edit temporary samples; offline CI does not run them. Disable the options after a dedicated test session.

## Release acceptance

Before a public release:

1. Run `npm test` on a clean checkout and on the extracted release archive.
2. Let the read-only CI matrix pass on Windows, macOS, and Linux / Node 22 and 24. Actions are commit-pinned; no installation scripts or publication credentials are needed.
3. Test each plugin alone and together in the target Desktop version. Check theme on/off, search including hidden/multiword paths, remote isolation, cancellation, file following, clicking/Enter, full-width toggle, English/Chinese switch, and manual fold/reopen protection.
4. On disposable files, test UTF-8, UTF-16/BOM, CRLF, external-edit rejection, explicit save, draft retention across tabs, and discard. Check copy/download/editor actions manually with consent.
5. Disable/re-enable/reload and switch sessions during pending work. Verify native UI recovery, no late-session updates, and no duplicate listeners.
6. Check screenshots, staged files, commit identities/history, license notices, and credentials. Keep MIT and third-party notices with any redistributed plugin folders.
7. Increment a changed package's version, record behavior changes, and disclose untested environments. Installed-package GUI updates are version-sensitive; live-source reload does not prove an installed archive works.

If a behavior has not been checked in Desktop, record it as pending, not passed. Avoid cosmetic rewrites, new dependencies, or architecture churn in a hardening change without a demonstrated benefit and regression coverage.
