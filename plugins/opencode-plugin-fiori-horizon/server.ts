import { Plugin } from "@opencode/plugin"

// Identity only: preserve the host's <plugin id>:<theme id> selection key.
// No server tools, hooks, file operations, or model behavior are registered.
export default Plugin.define({
  id: "fiori-horizon-light",
  setup() {},
})
