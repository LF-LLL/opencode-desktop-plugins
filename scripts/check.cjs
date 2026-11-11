"use strict";

// No dependency installation, host startup, network requests, or real user files.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const packages = ["fiori-horizon", "workspace-navigation", "ux-enhancements"];

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", timeout: 60000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Check failed: ${args.join(" ")}`);
}

function checkPackage(name) {
  const directory = path.join("plugins", `opencode-plugin-${name}`);
  const metadata = JSON.parse(fs.readFileSync(path.join(root, directory, "package.json"), "utf8"));
  if (metadata.name !== `opencode-plugin-${name}`) throw new Error(`Unexpected package identity: ${directory}`);
  for (const target of Object.values(metadata.exports)) {
    if (!target.startsWith("./") || !fs.statSync(path.join(root, directory, target)).isFile()) {
      throw new Error(`Missing package entry: ${directory}/${target}`);
    }
  }
  run(["--check", `${directory}/gui-experimental.cjs`]);
  run(["--check", `${directory}/test.cjs`]);
  run(["--unhandled-rejections=strict", `${directory}/test.cjs`]);
}

try {
  for (const name of packages) checkPackage(name);
  for (const test of fs.readdirSync(path.join(root, "tests")).filter(name => name.endsWith(".test.cjs")).sort()) {
    run(["--unhandled-rejections=strict", `tests/${test}`]);
  }
  console.log("PASS: package entry points, JavaScript syntax, plugin regressions, and filesystem integration.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
