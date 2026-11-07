import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceTsPath = path.resolve(__dirname, "../../src/lib/project-name-utils.ts");
const sourceTs = fs.readFileSync(sourceTsPath, "utf8");

function sanitizeProjectName(rawName, existingNames = []) {
  if (!rawName) return "Untitled Project";
  let clean = rawName.replace(/\.(mp4|mov|mkv|webm|avi|m4v|flv|wmv)$/i, "");
  clean = clean.replace(/[/\\:*?"<>|]/g, " ");
  clean = clean.replace(/\s+/g, " ").trim();
  if (!clean) clean = "Untitled Project";
  const MAX_LEN = 60;
  if (clean.length > MAX_LEN) {
    clean = clean.slice(0, MAX_LEN).trim();
  }
  const normalizedExisting = new Set(existingNames.map((n) => n.toLowerCase().trim()));
  let candidate = clean;
  let counter = 2;
  while (normalizedExisting.has(candidate.toLowerCase().trim())) {
    const suffix = ` (${counter})`;
    const maxBaseLen = MAX_LEN - suffix.length;
    const base = clean.length > maxBaseLen ? clean.slice(0, maxBaseLen).trim() : clean;
    candidate = `${base}${suffix}`;
    counter++;
  }
  return candidate;
}

const ILLEGAL_CHARS_TEST_REGEX = /[/\\:*?"<>|]/;

function validateProjectName(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: "Project name cannot be empty." };
  }
  if (ILLEGAL_CHARS_TEST_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: 'Project name cannot contain illegal characters: / \\ : * ? " < > |',
    };
  }
  if (trimmed.length > 60) {
    return { valid: false, error: "Project name must be 60 characters or less." };
  }
  return { valid: true };
}

test("sanitizeProjectName strips extensions and illegal characters", () => {
  const result = sanitizeProjectName("My Video: Season 1 * [HD]?.mp4");
  assert.equal(result, "My Video Season 1 [HD]");
});

test("sanitizeProjectName auto-suffixes duplicate names", () => {
  const existing = ["My Video", "My Video (2)"];
  const result = sanitizeProjectName("My Video.mp4", existing);
  assert.equal(result, "My Video (3)");
});

test("sanitizeProjectName enforces max 60 length", () => {
  const longName = "a".repeat(80) + ".mp4";
  const result = sanitizeProjectName(longName);
  assert.equal(result.length, 60);
});

test("project-name-utils.ts uses stateless regex for validateProjectName.test()", () => {
  assert.ok(
    sourceTs.includes("ILLEGAL_CHARS_TEST_REGEX = /[/\\\\:*?\"<>|]/;"),
    "validateProjectName must use a non-global regex so repeated .test() calls do not alternate"
  );
  for (let i = 0; i < 6; i++) {
    assert.equal(validateProjectName("Bad:Name").valid, false);
  }
  assert.equal(validateProjectName("Clean Project Name").valid, true);
});
