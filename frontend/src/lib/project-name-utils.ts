/**
 * Utility functions for project name formatting, sanitization, and deduplication.
 */

// Characters forbidden in filenames across Windows, macOS, and Linux
const ILLEGAL_CHARS_REGEX = /[/\\:*?"<>|]/g;

/**
 * Strips file extensions, removes illegal filename characters,
 * trims whitespace, enforces max length (60 chars), and auto-suffixes duplicates.
 */
export function sanitizeProjectName(
  rawName: string,
  existingNames: string[] = []
): string {
  if (!rawName) return "Untitled Project";

  // 1. Strip common video file extension
  let clean = rawName.replace(/\.(mp4|mov|mkv|webm|avi|m4v|flv|wmv)$/i, "");

  // 2. Strip characters illegal in filesystem names
  clean = clean.replace(ILLEGAL_CHARS_REGEX, " ");

  // 3. Normalize whitespace (collapse multiple spaces to single)
  clean = clean.replace(/\s+/g, " ").trim();

  // 4. Default fallback if empty
  if (!clean) clean = "Untitled Project";

  // 5. Enforce max length of 60 characters
  const MAX_LEN = 60;
  if (clean.length > MAX_LEN) {
    clean = clean.slice(0, MAX_LEN).trim();
  }

  // 6. Deduplicate against existing project names (case-insensitive)
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

/**
 * Validates a proposed project name.
 */
export function validateProjectName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: "Project name cannot be empty." };
  }
  if (ILLEGAL_CHARS_REGEX.test(trimmed)) {
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
