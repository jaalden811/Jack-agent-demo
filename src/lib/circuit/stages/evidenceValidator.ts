/**
 * Generic evidence-integrity validators (Phase 1/7). Circuit may interpret
 * evidence but may never INVENT it: every cited evidence ID must exist in
 * the input, every cited URL must exist in the supplied source set, and
 * supplied numeric scores must be unchanged. These run after schema
 * validation; any violation triggers one repair, then deterministic
 * fallback.
 */

/** Collects every string that looks like an evidence-id reference from an
 * arbitrary output object (any `evidence_ids: string[]` arrays). */
export function collectEvidenceIdReferences(output: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if ((key === "evidence_ids" || key === "evidence_id") && Array.isArray(value)) {
          for (const v of value) if (typeof v === "string") ids.push(v);
        } else if ((key === "evidence_id") && typeof value === "string") {
          ids.push(value);
        } else {
          walk(value);
        }
      }
    }
  };
  walk(output);
  return ids;
}

/** Returns cited evidence IDs that are NOT present in the allowed set. */
export function invalidEvidenceIds(output: unknown, allowedIds: Iterable<string>): string[] {
  const allowed = new Set(allowedIds);
  const cited = collectEvidenceIdReferences(output);
  return Array.from(new Set(cited.filter((id) => id.length > 0 && !allowed.has(id))));
}

/** Collects every http(s) URL string from an arbitrary output object. */
export function collectUrls(output: unknown): string[] {
  const urls: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      const matches = node.match(/https?:\/\/[^\s"')]+/gi);
      if (matches) urls.push(...matches);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node as Record<string, unknown>)) walk(value);
    }
  };
  walk(output);
  return urls;
}

/** Returns URLs in the output that are NOT present in the allowed source
 * set (Circuit must never introduce a URL that wasn't supplied). */
export function invalidUrls(output: unknown, allowedUrls: Iterable<string>): string[] {
  const allowed = new Set(Array.from(allowedUrls).map((u) => u.trim()));
  const cited = collectUrls(output);
  return Array.from(new Set(cited.filter((u) => !allowed.has(u.trim()))));
}
