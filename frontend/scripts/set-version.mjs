import { readFile, writeFile } from "node:fs/promises";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: npm run version:set -- <major.minor.patch[-prerelease]>");
  process.exit(1);
}

const packagePath = new URL("../package.json", import.meta.url);
const lockPath = new URL("../package-lock.json", import.meta.url);
const tauriPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const cargoPath = new URL("../src-tauri/Cargo.toml", import.meta.url);
const cargoLockPath = new URL("../src-tauri/Cargo.lock", import.meta.url);

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const packageLock = JSON.parse(await readFile(lockPath, "utf8"));
const tauriConfig = JSON.parse(await readFile(tauriPath, "utf8"));
let cargoToml = await readFile(cargoPath, "utf8");
let cargoLock = await readFile(cargoLockPath, "utf8");

const cargoManifestVersion =
  /^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m;
const cargoLockVersion =
  /^(\[\[package\]\]\r?\nname = "app"\r?\nversion = ")[^"]+(")/m;

if (!cargoManifestVersion.test(cargoToml)) {
  throw new Error("Could not find the app version in src-tauri/Cargo.toml.");
}
if (!cargoLockVersion.test(cargoLock)) {
  throw new Error("Could not find the app entry in src-tauri/Cargo.lock.");
}
if (!packageLock.packages?.[""]) {
  throw new Error("Could not find the root package in package-lock.json.");
}

packageJson.version = version;
packageLock.version = version;
packageLock.packages[""].version = version;
tauriConfig.version = version;
cargoToml = cargoToml.replace(cargoManifestVersion, `$1${version}$2`);
cargoLock = cargoLock.replace(cargoLockVersion, `$1${version}$2`);

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`),
  writeFile(tauriPath, `${JSON.stringify(tauriConfig, null, 2)}\n`),
  writeFile(cargoPath, cargoToml),
  writeFile(cargoLockPath, cargoLock),
]);

console.log(`Set all Clip Robin app manifests to version ${version}.`);
