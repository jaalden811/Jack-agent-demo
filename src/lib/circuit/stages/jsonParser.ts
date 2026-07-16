/**
 * Extracts exactly one JSON object from a model's text output. The master
 * prompt requires JSON-only, but models occasionally wrap it in prose or a
 * ```json fence — this tolerates those wrappers WITHOUT accepting a
 * different shape (it only locates the outermost {...} object). Returns
 * null when no parseable object is present (the runner then repairs once,
 * then falls back deterministically).
 */
export function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  const trimmed = text.trim();

  // Fast path: already pure JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // Strip a leading ```json / ``` fence if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // Locate the outermost balanced { ... } object and parse it.
  const start = trimmed.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
