import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("check-version script validates synchronized manifests", async () => {
  const packagePath = new URL("../../package.json", import.meta.url);
  const lockPath = new URL("../../package-lock.json", import.meta.url);
  const tauriPath = new URL("../../src-tauri/tauri.conf.json", import.meta.url);

  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const tauri = JSON.parse(await readFile(tauriPath, "utf8"));

  assert.equal(pkg.version, lock.version, "package.json and package-lock.json version match");
  assert.equal(pkg.version, tauri.version, "package.json and tauri.conf.json version match");
});

test("version string format adheres to semver", async () => {
  const packagePath = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Valid semver version format");
});
