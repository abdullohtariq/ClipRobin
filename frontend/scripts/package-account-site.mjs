import { cp, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const build = fileURLToPath(new URL("../out/", import.meta.url));
const args = process.argv.slice(2);
const noIndex = args.includes("--no-index");
const targetArg = args.find((arg) => !arg.startsWith("--"));
const destination = targetArg && resolve(targetArg);
if (!destination) throw new Error("Pass a target directory for the Account & Plans site.");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await writeFile(join(destination, ".nojekyll"), "");
for (const directory of ["_next", "subscription"]) {
  await cp(join(build, directory), join(destination, directory), { recursive: true });
}
for (const file of ["favicon.ico", "logo-mark.svg"]) {
  await copyFile(join(build, file), join(destination, file));
}
if (!noIndex) {
  await writeFile(join(destination, "_headers"), `/*
  Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
`);
  await writeFile(join(destination, "index.html"), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=./subscription/"><title>Clip Robin</title>
<a href="./subscription/">Open Clip Robin Account &amp; Plans</a></html>`);
}
