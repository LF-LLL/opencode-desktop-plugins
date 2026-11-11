# Changelog

## Unreleased hardening

Package versions: Fiori Horizon 1.4.1, Workspace Navigation 1.0.1, UX Enhancements 1.2.1.

- Replace product-specific test fixture names with fictional project/report paths.
- Forward search cancellation through IPC; check cancellation during traversal and prevent unloaded scans from repopulating caches. Bound completed root caches and scheduled directories; preserve native-search fallback and capture session scope before asynchronous work.
- Make local diagnostics opt-in and require a separate developer option for interactive maintenance probes.
- Keep tool output out of activity snapshots, validate incoming events/snapshots, bound pending events, and avoid replacing newer live state with a late snapshot.
- Redact common credential forms in added summaries without rewriting the host transcript.
- Reject malformed/binary new text and network/device/NTFS-stream save paths; flush the opened file before reporting a successful save. Existing non-atomic write limitations still apply.
- Guard missing host capabilities and preserve read-only/native behavior where possible. Use Command for the macOS full-width shortcut; macOS Desktop behavior is not yet manually verified.
- Add dependency-free checks, real temporary-filesystem/lifecycle regressions, read-only commit-pinned CI, and security/contribution guidance. Preserve plugin/IPC/theme identities and copy-folder installation.

Acceptance status: offline tests are separate from Desktop interaction acceptance. No claim of universal SDK, OS, or crash-safe persistence compatibility.
