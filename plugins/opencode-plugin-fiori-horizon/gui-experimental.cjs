"use strict";

// The desktop host supplies this module. No npm install or ASAR patch is needed.
const { Plugin, Style, Theme, Command } = require("@opencode/plugin/gui");

// SAP theming-base-content 11.36.5, sap_horizon/variables.json.
// Component assignments and pale categorical tints are our OpenCode adaptation.
const sap = {
  brand: "#0070f2", highlight: "#0064d9", text: "#131e29", label: "#556b82",
  background: "#f5f6f7", shell: "#eff1f2", border: "#e5e5e5",
  purple: "#6c32a9", teal: "#046c7a", amber: "#b44f00",
  success: "#256f3a", error: "#aa0808", infoBackground: "#e1f4ff",
  successBackground: "#f5fae5", errorBackground: "#ffeaf4", warningBackground: "#fff8d6",
  selection: "#ebf8ff", focus: "#0032a5", radius: "0.75rem",
  shadow: "0 0 0.125rem 0 rgba(34,53,72,0.2), 0 0.125rem 0.25rem 0 rgba(34,53,72,0.2)",
  floatingShadow: "0 0 0 0.0625rem rgba(34,53,72,0.48), 0 0.625rem 1.875rem 0 rgba(34,53,72,0.25)"
};

const theme = {
  name: "Fiori Horizon Light",
  id: "fiori-horizon-light",
  light: {
    palette: {
      neutral: sap.background, ink: sap.text, primary: sap.brand,
      interactive: sap.brand, success: sap.success, warning: sap.amber,
      error: sap.error, info: sap.highlight
    },
    overrides: {
      "v2-background-bg-base": "#ffffff",
      "v2-background-bg-deep": sap.shell,
      "v2-background-bg-layer-01": sap.background,
      "v2-background-bg-layer-02": "#eaf1f7",
      "v2-background-bg-layer-03": "#e0eaf3",
      "v2-background-bg-accent": "#0070f2",
      "v2-text-text-base": sap.text,
      "v2-text-text-muted": "#556b82",
      "v2-text-text-accent": "#0064d9",
      "v2-text-text-accent-hover": "#004da6",
      "v2-text-text-code-accent": sap.purple,
      "v2-text-text-code-path": "#0064d9",
      "v2-border-border-base": "#d8e2eb",
      "v2-border-border-focus": sap.focus,
      "v2-state-fg-danger": sap.error,
      "v2-state-fg-warning": sap.amber,
      "v2-state-fg-success": sap.success,
      "syntax-keyword": sap.purple,
      "syntax-string": sap.teal,
      "syntax-function": "#0064d9",
      "syntax-number": "#985900"
    }
  },
  dark: {
    palette: {
      neutral: "#1d2d3e", ink: "#edf3f8", primary: "#78b7ff",
      interactive: "#78b7ff", success: "#75cda9", warning: "#efc16e",
      error: "#ff8dbb", info: "#c7a4df"
    }
  }
};

// Only light windows are changed. Keep source code highlighting and text intact.
const css = `
:root[data-fiori-style="on"][data-color-scheme="light"] {
  --fiori-blue: ${sap.highlight};
  --fiori-purple: ${sap.purple};
  --fiori-teal: ${sap.teal};
  --fiori-amber: ${sap.amber};
  --fiori-success: ${sap.success};
  --fiori-error: ${sap.error};
  --fiori-body: ${sap.text};
  --fiori-label: ${sap.label};
  --fiori-page: ${sap.background};
  --fiori-radius: ${sap.radius};
  --fiori-shadow: ${sap.shadow};
  --v2-background-bg-base: #ffffff;
  --v2-background-bg-deep: ${sap.shell};
  --v2-background-bg-layer-01: ${sap.background};
  --v2-background-bg-layer-02: #eaf1f7;
  --v2-background-bg-layer-03: #e0eaf3;
  --v2-background-bg-accent: ${sap.brand};
  --v2-text-text-base: ${sap.text};
  --v2-text-text-muted: #556b82;
  --v2-text-text-accent: #0064d9;
  --v2-text-text-accent-hover: #004da6;
  --v2-text-text-code-accent: ${sap.purple};
  --v2-text-text-code-path: #0064d9;
  --v2-icon-icon-accent: #0064d9;
  --v2-icon-icon-accent-hover: #004da6;
  --v2-border-border-base: #d8e2eb;
  --v2-border-border-focus: ${sap.focus};
  --v2-state-fg-danger: ${sap.error};
  --v2-state-fg-warning: ${sap.amber};
  --v2-state-fg-success: ${sap.success};
  --v2-state-bg-danger: ${sap.errorBackground};
  --v2-state-bg-warning: ${sap.warningBackground};
  --v2-state-bg-success: ${sap.successBackground};
  --v2-state-bg-info: ${sap.infoBackground};
  --v2-state-fg-info: ${sap.highlight};
  --v2-elevation-raised: ${sap.shadow};
  --v2-elevation-floating: ${sap.floatingShadow};
  --v2-elevation-overlay: ${sap.floatingShadow};
  --v2-text-text-faint: #5b738b;
  --v2-icon-icon-base: ${sap.highlight};
  --v2-icon-icon-muted: #5b738b;
  --v2-overlay-simple-overlay-hover: #eaecee;
  --v2-overlay-simple-overlay-pressed: ${sap.selection};
  --background-base: #fff;
  --background-stronger: ${sap.background};
  --surface-base: #fff;
  --surface-base-hover: #eaecee;
  --surface-base-active: ${sap.selection};
  --surface-raised-base: #fff;
  --surface-raised-base-hover: ${sap.selection};
  --surface-raised-stronger-non-alpha: #fff;
  --text-base: ${sap.text};
  --text-strong: ${sap.text};
  --text-weak: ${sap.label};
  --text-interactive-base: ${sap.highlight};
  --icon-base: ${sap.highlight};
  --icon-weak-base: ${sap.label};
  --icon-strong-base: ${sap.highlight};
  --border-weak-base: ${sap.border};
  scrollbar-color: #7b91a8 #fff;
}
/* Fiori emphasized action: blue fill and white content, not all buttons. */
:root[data-fiori-style="on"][data-color-scheme="light"] :is([data-component="button-v2"], [data-component="icon-button-v2"])[data-variant="submit"]:not(:disabled) {
  background: ${sap.brand};
  color: #fff;
}
:root[data-fiori-style="on"][data-color-scheme="light"] :is([data-component="button-v2"], [data-component="icon-button-v2"])[data-variant="submit"]:not(:disabled):hover {
  background: ${sap.highlight};
}

/* Shell, panels, and navigation. Preserve sizes and drag/scroll behavior. */
:root[data-fiori-style="on"][data-color-scheme="light"] :is([data-slot="titlebar-tabs"], [data-slot="vertical-tabs-sidebar"]) {
  background-color: ${sap.shell};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-titlebar-tab][data-active="true"] {
  color: var(--fiori-blue);
  background-color: ${sap.selection};
  box-shadow: inset 0 -2px var(--fiori-blue);
}
:root[data-fiori-style="on"][data-color-scheme="light"] :is([data-slot="session-side-panel-presence"], [data-slot="session-side-panel-content"], [data-component="session-review-v2"]) {
  background-color: #fff;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="session-review-v2-sidebar"] {
  background-color: #fff;
  border-inline-end-color: #d9d9d9;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="session-review-v2-sidebar-header"] {
  background-color: ${sap.background};
  box-shadow: inset 0 -1px #d9d9d9;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="session-review-v2-sidebar-title"] {
  color: var(--fiori-blue);
  font-weight: 600;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="session-review-v2-sidebar-filter"] [data-component="text-input-v2"]:not([data-invalid],[data-disabled]) {
  background: #fff;
  box-shadow: inset 0 0 0 1px #758ca4;
  border-radius: .25rem;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="session-review-v2-sidebar-filter"] [data-component="text-input-v2"]:focus-within:not([data-invalid],[data-disabled]) {
  box-shadow: inset 0 0 0 2px ${sap.focus};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="tabs"] [data-slot="tabs-list"] {
  background-color: ${sap.background};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="tabs"] [data-slot="tabs-trigger-wrapper"] {
  background-color: #fff;
  color: var(--fiori-label);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="tabs"] [data-slot="tabs-trigger-wrapper"]:has([data-selected]) {
  background-color: ${sap.selection};
  color: var(--fiori-blue);
  box-shadow: inset 0 -2px var(--fiori-blue);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="tabs"] [data-slot="tabs-trigger-wrapper"]:hover:not(:has([data-selected])) {
  background-color: #eaecee;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="tabs-trigger"]:focus-visible {
  outline: 2px solid ${sap.focus};
  outline-offset: -2px;
}

/* The virtual file tree has an open shadow root. Its host tokens are public CSS. */
:root[data-fiori-style="on"][data-color-scheme="light"] file-tree-container.opencode-pierre-file-tree {
  --trees-bg: #fff;
  --trees-fg: ${sap.text};
  --trees-fg-muted: ${sap.label};
  --trees-selected-bg: ${sap.selection};
  --trees-selected-fg: ${sap.highlight};
  --trees-indent-guide-bg: #d8e2eb;
  --trees-border-color: #d8e2eb;
  --v2-text-text-base: ${sap.highlight};
  --v2-icon-icon-muted: ${sap.teal};
  --v2-overlay-simple-overlay-hover: #eaecee;
  --v2-overlay-simple-overlay-pressed: ${sap.selection};
  background-color: #fff;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="file-tree-v2"] [data-slot="file-tree-v2-row"] {
  color: var(--fiori-body);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="file-tree-v2"] [data-slot="file-tree-v2-row"][data-item-selected="true"] {
  color: var(--fiori-blue);
  background-color: ${sap.selection};
}

/* Composer, forms, menus, and settings use the same Fiori surface hierarchy. */
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="composer-face"] {
  background: #fff;
  border-radius: var(--fiori-radius);
  box-shadow: var(--fiori-shadow);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="composer-face"]:focus-within {
  box-shadow: var(--fiori-shadow), inset 0 0 0 1px ${sap.highlight};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="composer-controls"] {
  color: var(--fiori-label);
  background-color: #f5f6f7;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="text-input-v2"]:not([data-surface="invisible"],[data-invalid],[data-disabled]) {
  background: #fff;
  border-radius: .25rem;
  box-shadow: inset 0 0 0 1px #758ca4;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="text-input-v2"]:focus-within:not([data-invalid],[data-disabled]) {
  outline-color: ${sap.focus};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="button-v2"][data-variant="neutral"]:not(:disabled) {
  color: var(--fiori-blue);
  background-color: #fff;
  border-radius: .5rem;
}
:root[data-fiori-style="on"][data-color-scheme="light"] :is([data-component="button-v2"], [data-component="icon-button-v2"])[data-variant="submit"] {
  border-radius: .5rem;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="switch-control"] {
  border-radius: .5rem;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="switch-thumb"] {
  border-radius: 50%;
}
:root[data-fiori-style="on"][data-color-scheme="light"] :is([data-component="menu-v2-content"], [data-component="popover-content"], [data-slot="select-v2-listbox"]) {
  background-color: #fff;
  color: var(--fiori-body);
  border-radius: var(--fiori-radius);
  box-shadow: ${sap.floatingShadow};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="menu-v2-item"] {
  --menu-v2-fg-muted: ${sap.label};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="menu-v2-item"][data-selected]:not([data-disabled],[data-variant="danger"],[data-variant="destructive"],[data-kind="danger"],[data-kind="destructive"]) {
  --menu-v2-fg: ${sap.highlight};
  background-color: ${sap.selection};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="dialog-v2"] [data-slot="dialog-container"] {
  background-color: #fff;
  border-radius: var(--fiori-radius);
  box-shadow: ${sap.floatingShadow};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="tooltip-v2"] {
  color: var(--fiori-body);
  background-color: #fff;
  border-radius: .25rem;
  box-shadow: var(--fiori-shadow);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="settings-list"] {
  background-color: #fff;
  border-radius: var(--fiori-radius);
  box-shadow: var(--fiori-shadow);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="settings-row"] {
  border-bottom-color: ${sap.border};
}
:root[data-fiori-style="on"][data-color-scheme="light"] .toast-v2 {
  border-radius: var(--fiori-radius);
  box-shadow: ${sap.floatingShadow};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] {
  --markdown-inline-code-path-color: #0064d9;
  --markdown-inline-code-color: ${sap.purple};
  --markdown-shell-code-background: #f3f7fc;
  --markdown-shell-code-border: #d6e4f2;
  --markdown-shell-code-color: ${sap.text};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] :is(h1,h2) {
  color: var(--fiori-blue);
  border-inline-start: 3px solid #0070f2;
  padding-inline-start: 10px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] h3 {
  color: var(--fiori-teal);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] :is(h4,h5,h6) {
  color: var(--fiori-purple);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] :is(strong,b) {
  color: #244a70;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] :not(pre) > code {
  color: var(--fiori-purple);
  background: color-mix(in srgb, var(--fiori-purple) 7%, white);
  border-radius: 4px;
  padding: 0 4px;
  box-decoration-break: clone;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] :not(pre) > code[data-inline-code-kind="path"] {
  color: var(--fiori-blue);
  background: #eaf3fc;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] a.external-link > code[data-inline-code-kind="url"] {
  color: var(--fiori-blue);
  background: #eaf3fc;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] li::marker {
  color: var(--fiori-blue);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] li li::marker {
  color: var(--fiori-teal);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] blockquote {
  color: var(--fiori-teal);
  background: color-mix(in srgb, var(--fiori-teal) 6%, white);
  border-inline-start: 3px solid var(--fiori-teal);
  border-radius: 0 6px 6px 0;
  padding: 10px 14px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] blockquote > p:last-child {
  margin-bottom: 0;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] table {
  border-color: #d8e2eb;
  border-radius: var(--fiori-radius);
  box-shadow: var(--fiori-shadow);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] :is(th,thead) {
  color: #244a70;
  background: #eaf2fb;
  border-color: #d8e2eb;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] td {
  border-color: #e1e9f0;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] tbody tr:nth-child(even) {
  background: #f6f9fc;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] tbody tr:hover {
  background: #edf5ff;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] .highlights {
  background: #f3f7fc;
  border: 1px solid #d6e4f2;
  border-inline-start: 3px solid #7b9fc9;
  border-radius: 6px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] details {
  border: 1px solid #eadfc9;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 12px 0;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="markdown"] summary {
  color: var(--fiori-amber);
  font-weight: 600;
}

/* Execution history: category color is not a success/failure indicator. */
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="context-tool-group-trigger"] {
  background: #f0f6fc;
  border-radius: 6px;
  box-shadow: inset 3px 0 ${sap.brand};
  padding-inline: 10px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] :is([data-component="tool-trigger"], [data-component="context-tool-group-trigger"]) [data-slot="basic-tool-tool-title"] {
  color: var(--fiori-blue);
  font-weight: 600;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="context-tool-group-count"] {
  color: var(--fiori-blue);
  font-weight: 600;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="context-tool-group-list"] {
  background: var(--fiori-page);
  border: 1px solid #e2e8ee;
  border-radius: var(--fiori-radius);
  padding: 6px 10px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="tool-trigger"] :is([data-slot="basic-tool-tool-subtitle"], [data-slot="basic-tool-tool-arg"]) {
  color: var(--fiori-label);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="context-tool-group-list"] :is([data-slot="basic-tool-tool-title"], [data-slot="read-tool-group-arrow"]) {
  color: var(--fiori-teal);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="read-tool-group"] [data-slot="basic-tool-tool-title"] {
  color: var(--fiori-teal);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="read-tool-group"] [data-slot="basic-tool-tool-subtitle"] {
  color: var(--fiori-blue);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="context-tool-group-matches"] {
  color: var(--fiori-teal);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="tool-trigger"] :is([data-slot="basic-tool-tool-spinner"], [data-component="spinner"]) {
  color: var(--fiori-blue);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="tool-part-wrapper"]:has([data-component="execute-tool-calls"]) > [data-component="collapsible"] > [data-slot="collapsible-trigger"] [data-slot="basic-tool-tool-title"] {
  color: var(--fiori-purple);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="execute-tool-calls"] {
  color: var(--fiori-label);
  background: #fff;
  border: 1px solid #e5e5e5;
  border-inline-start: 3px solid var(--fiori-purple);
  border-radius: 8px;
  padding: 8px 10px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-call-name"] {
  color: var(--fiori-purple);
  font-weight: 530;
}
:root[data-fiori-style="on"][data-color-scheme="light"] :is([data-slot="execute-tool-call-marker"], [data-slot="execute-tool-call-arrow"]) {
  color: var(--fiori-purple);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-call-args"] {
  color: var(--fiori-label);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-call"][data-kind="output"] {
  background: #f0f7f8;
  border-radius: 4px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-call"][data-kind="output"] :is([data-slot="execute-tool-call-name"], [data-slot="execute-tool-call-args"], [data-slot="execute-tool-call-marker"], [data-slot="execute-tool-call-arrow"]) {
  color: var(--fiori-teal);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-call"][role="button"]:hover {
  background: ${sap.selection};
  border-radius: 4px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-call-input"] {
  background: #f5f6f7;
  border-inline-start: 2px solid #d3c4e7;
  border-radius: 0 4px 4px 0;
  padding-block: 4px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-call-input-entry"] dt {
  color: var(--fiori-teal);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-call-input-entry"] dd {
  color: var(--fiori-body);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-output"] {
  background: #f5f6f7;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--fiori-body);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="bash-output"] {
  border: 1px solid #d8e2eb;
  border-inline-start: 3px solid var(--fiori-blue);
  border-radius: var(--fiori-radius);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="bash-output"] [data-slot="bash-command"] {
  color: var(--fiori-blue);
  background: #fff;
  --bash-section-background: #fff;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="bash-output"] [data-slot="bash-result"] {
  color: var(--fiori-body);
  background: var(--fiori-page);
  --bash-section-background: var(--fiori-page);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="tool-output"] {
  color: var(--fiori-body);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="question-answers"] {
  background: #fffdf3;
  border: 1px solid #eadfc9;
  border-inline-start: 3px solid #d27700;
  border-radius: 8px;
  padding: 10px 12px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="question-answers"] [data-slot="question-text"] {
  color: var(--fiori-label);
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="question-answers"] [data-slot="answer-text"] {
  color: var(--fiori-blue);
  font-weight: 600;
}
/* Explicit error state wins over category colors. No log-text parsing. */
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-call"][data-status="error"] {
  background: ${sap.errorBackground};
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-slot="execute-tool-call"][data-status="error"] :is([data-slot="execute-tool-call-name"], [data-slot="execute-tool-call-marker"], [data-slot="execute-tool-call-arrow"]) {
  color: var(--fiori-error);
}
:root[data-fiori-style="on"][data-color-scheme="light"] :is([data-slot="execute-tool-error"], [data-slot="execute-details-error"], [data-component="card"][data-kind="tool-error-card"], [data-component="card"][data-kind="session-error-card"]) {
  color: var(--fiori-error);
  background: ${sap.errorBackground};
  border: 1px solid #f0c4d5;
  border-inline-start: 3px solid var(--fiori-error);
  border-radius: 8px;
  padding: 8px 10px;
}
:root[data-fiori-style="on"][data-color-scheme="light"] [data-component="card"][data-kind="tool-error-card"] :is([data-slot="basic-tool-tool-title"], [data-slot="tool-error-card-summary"], [data-component="tool-error-card-icon"]) {
  color: var(--fiori-error);
}
`;

function getDiagnosticDirectory(localAppData, tempDirectory, userId, pathModule) {
  if (typeof localAppData === "string" && localAppData.trim()) {
    return pathModule.join(localAppData, "Temp", "opencode");
  }
  const userPart = Number.isInteger(userId) ? `opencode-${userId}` : "opencode-user";
  return pathModule.join(tempDirectory, userPart);
}

module.exports = Plugin.define({
  // Read only style metadata for local verification, never message content.
  async main(ctx) {
    // File-tree paths can identify a user's workspace. Diagnostics are opt-in.
    if (ctx.options?.diagnostics !== true) return;
    const { BrowserWindow } = require("electron");
    const fs = require("node:fs/promises");
    const path = require("node:path");
    const os = require("node:os");
    const userId = typeof process.getuid === "function" ? process.getuid() : undefined;
    const diagnosticDirectory = getDiagnosticDirectory(process.env.LOCALAPPDATA, os.tmpdir(), userId, path);
    try {
      await fs.mkdir(diagnosticDirectory, { recursive: true, mode: 0o700 });
    } catch {
      // Diagnostics are optional; a read-only temp directory must not disable the plugin.
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    const results = [];
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      const result = await window.webContents.executeJavaScript(`(() => {
        const root = document.documentElement;
        const markdown = document.querySelector('[data-component="markdown"]');
        const code = document.querySelector('[data-component="markdown"] :not(pre) > code');
        const sample = selector => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const style = getComputedStyle(element);
          return { color: style.color, background: style.backgroundColor, radius: style.borderRadius };
        };
        const fixture = document.createElement('div');
        fixture.setAttribute('aria-hidden', 'true');
        fixture.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;';
        fixture.innerHTML = '<div data-component="execute-tool-calls"><div data-slot="execute-tool-call"><span data-slot="execute-tool-call-name"></span></div><div data-slot="execute-tool-call" data-kind="output"><span data-slot="execute-tool-call-name"></span></div><div data-slot="execute-tool-call" data-status="error"><span data-slot="execute-tool-call-name"></span></div></div><div data-component="tabs"><div data-slot="tabs-trigger-wrapper"><button data-slot="tabs-trigger" data-selected></button></div></div><div data-component="text-input-v2"></div><div data-component="settings-list"></div><div data-component="menu-v2-item" data-selected></div><div data-component="markdown"><p><code></code></p></div>';
        document.body.appendChild(fixture);
        let fixtureColors, fixtureUi;
        try {
          fixtureColors = Array.from(fixture.querySelectorAll('[data-slot="execute-tool-call-name"]'), element => getComputedStyle(element).color);
          fixtureUi = Object.fromEntries(['[data-slot="tabs-trigger-wrapper"]', '[data-component="text-input-v2"]', '[data-component="settings-list"]', '[data-component="menu-v2-item"]', '[data-component="markdown"] code'].map(selector => {
            const style = getComputedStyle(fixture.querySelector(selector));
            return [selector, { color: style.color, background: style.backgroundColor, radius: style.borderRadius }];
          }));
        } finally {
          fixture.remove();
        }
        return {
          scheme: root.dataset.colorScheme,
          styling: root.dataset.fioriStyle,
          bodyColor: getComputedStyle(root).getPropertyValue('--v2-text-text-base').trim(),
          markdownColor: markdown ? getComputedStyle(markdown).color : null,
          codeColor: code ? getComputedStyle(code).color : null,
          codeBackground: code ? getComputedStyle(code).backgroundColor : null,
          toolHeader: sample('[data-component="tool-trigger"] [data-slot="basic-tool-tool-title"]'),
          groupHeader: sample('[data-component="context-tool-group-trigger"]'),
          groupList: sample('[data-component="context-tool-group-list"]'),
          executeName: sample('[data-slot="execute-tool-call"]:not([data-kind="output"]):not([data-status="error"]) [data-slot="execute-tool-call-name"]'),
          outputName: sample('[data-slot="execute-tool-call"][data-kind="output"] [data-slot="execute-tool-call-name"]'),
          fixtureCallOutputErrorColors: fixtureColors,
          fixtureUi: fixtureUi,
          applicationUi: {
            sidebarHeader: sample('[data-slot="session-review-v2-sidebar-header"]'),
            sidebarTitle: sample('[data-slot="session-review-v2-sidebar-title"]'),
            selectedTab: sample('[data-slot="tabs-trigger-wrapper"]:has([data-selected])'),
            composer: sample('[data-slot="composer-face"]'),
            tree: Array.from(document.querySelectorAll('file-tree-container'), e => {
              const style = getComputedStyle(e);
              const row = e.shadowRoot?.querySelector('button[data-type="item"]');
              const icon = row?.querySelector('[data-item-section="icon"] svg');
              return {
                foreground: style.getPropertyValue('--trees-fg').trim(),
                selection: style.getPropertyValue('--trees-selected-bg').trim(),
                rowColor: row ? getComputedStyle(row).color : null,
                iconColor: icon ? getComputedStyle(icon).color : null,
                visibleRows: e.shadowRoot?.querySelectorAll('button[data-type="item"]').length ?? 0,
                expandedRows: Array.from(e.shadowRoot?.querySelectorAll('[aria-expanded="true"][data-item-path]') || [], row => row.getAttribute('data-item-path')),
                selectedRows: Array.from(e.shadowRoot?.querySelectorAll('[aria-selected="true"][data-item-path]') || [], row => row.getAttribute('data-item-path'))
              };
            })
          },
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        };
      })()`);
      results.push(result);
    }
    // Keep diagnostics outside the watched plugin directory to avoid reload loops.
    const output = path.join(diagnosticDirectory, "fiori-verification.json");
    try {
      await fs.writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), windows: results }, null, 2));
    } catch {
      // Diagnostic snapshots are best-effort and contain no user message content.
    }
  },
  i18n: {
    en: { "command.toggle": "Toggle Fiori light styling" },
    zh: { "command.toggle": "切换 Fiori 浅色样式" }
  },
  setup(ctx) {
    const root = document.documentElement;
    const previous = root.getAttribute("data-fiori-style");
    root.setAttribute("data-fiori-style", "on");
    ctx.add(Theme, theme);
    ctx.add(Style, css);
    ctx.add(Command, () => ({
      id: "toggle", title: ctx.t("command.toggle"),
      keywords: "fiori theme light sap colors",
      run() {
        root.setAttribute("data-fiori-style", root.getAttribute("data-fiori-style") === "on" ? "off" : "on");
      }
    }));
    return () => {
      if (previous === null) root.removeAttribute("data-fiori-style");
      else root.setAttribute("data-fiori-style", previous);
    };
  }
});
