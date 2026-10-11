import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const packageLock = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const tauriConfig = JSON.parse(
  await readFile(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const cargoToml = await readFile(
  new URL("../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
const cargoLock = await readFile(
  new URL("../src-tauri/Cargo.lock", import.meta.url),
  "utf8",
);
const cargoVersion = cargoToml.match(
  /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
)?.[1];
const cargoLockVersion = cargoLock.match(
  /^\[\[package\]\]\r?\nname = "app"\r?\nversion = "([^"]+)"/m,
)?.[1];

const versions = {
  "frontend/package.json": packageJson.version,
  "frontend/package-lock.json": packageLock.packages?.[""]?.version,
  "frontend/src-tauri/tauri.conf.json": tauriConfig.version,
  "frontend/src-tauri/Cargo.toml": cargoVersion,
  "frontend/src-tauri/Cargo.lock": cargoLockVersion,
};
const expectedTag = process.argv[2]?.replace(/^v/, "");
const uniqueVersions = new Set(Object.values(versions));

if (Object.values(versions).some((version) => !version)) {
  console.error("Could not read every application version from its manifest.");
  process.exitCode = 1;
} else if (uniqueVersions.size !== 1) {
  console.error("Application versions do not match:");
  for (const [manifest, version] of Object.entries(versions)) {
    console.error(`  ${manifest}: ${version}`);
  }
  process.exitCode = 1;
} else if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  console.error(`Application version ${packageJson.version} is not valid SemVer.`);
  process.exitCode = 1;
} else if (expectedTag && !uniqueVersions.has(expectedTag)) {
  console.error(
    `Release tag v${expectedTag} does not match app version ${packageJson.version}.`,
  );
  process.exitCode = 1;
} else {
  console.log(`All application manifests use version ${packageJson.version}.`);
}
