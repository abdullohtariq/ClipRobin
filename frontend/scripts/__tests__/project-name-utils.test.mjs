import test from "node:test";
import assert from "node:assert/strict";

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
  const normalizedExisting = existingNames.map((n) => n.toLowerCase().trim());
  let candidate = clean;
  let counter = 2;
  while (normalizedExisting.includes(candidate.toLowerCase().trim())) {
    const suffix = ` (${counter})`;
    const maxBaseLen = MAX_LEN - suffix.length;
    const base = clean.length > maxBaseLen ? clean.slice(0, maxBaseLen).trim() : clean;
    candidate = `${base}${suffix}`;
    counter++;
  }
  return candidate;
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

