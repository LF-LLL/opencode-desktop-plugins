# Security and privacy

These plugins execute trusted local code in OpenCode Desktop. They are not sandboxed by agent permission prompts. Install only source you trust; the MIT warranty disclaimer is not a security certification.

## Data handling

- No plugin-defined telemetry, remote uploads, or additional model calls.
- Navigation delegates to the existing OpenCode file-search service and supplements **local sessions only** with a file-name index. It deliberately includes hidden/gitignored names, not contents.
- UX reads the current session's context/events for presentation and the host's current file preview for explicit editing/copy/download actions. Tool-output bodies are not duplicated into the activity snapshot.
- Saves happen only through an explicit GUI Save action or the editor shortcut. Local text saves are bounded and conflict-checked, but not atomic and not a filesystem sandbox.
- Clipboard, download, and external-editor actions are user-triggered. A selected external editor is an executable chosen by the user; do not select an untrusted program.
- Unsaved drafts stay in window memory. Common credentials in added summaries are redacted on a best-effort basis. This does not sanitize the original transcript, screenshots, or clipboard.
- Diagnostics are off by default. Opt-in diagnostics can record paths. Interactive probes require a separate developer option; see [maintenance guidance](CONTRIBUTING.md#diagnostics).

## Reporting

For an ordinary defect, open an issue with the package/Desktop version, operating system, reproduction steps, and expected/actual behavior. Use fictional data and remove paths, transcripts, credentials, and customer information.

For a sensitive vulnerability, use GitHub's private vulnerability reporting if the repository has it enabled. Otherwise, arrange a private channel with the maintainer before sharing exploit details. Do not post a credential or private customer record in a public issue. This repository does not promise a response SLA.

Only versions explicitly tested against the target Desktop release should be treated as compatible. The GUI SDK is experimental; disable a plugin when an upgrade invalidates its contract. See [release acceptance](CONTRIBUTING.md#release-acceptance) for the verification boundary.
