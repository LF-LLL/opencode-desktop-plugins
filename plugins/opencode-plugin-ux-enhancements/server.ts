import { Plugin } from "@opencode/plugin"

// Keep the existing ID so IPC contracts and window drafts retain their namespace.
export default Plugin.define({
  id: "desktop-workflow",
  // Language belongs to the user's instructions, not a desktop UX plugin.
  setup() {},
})
