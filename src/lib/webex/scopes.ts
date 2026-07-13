/**
 * Normalizes the raw WEBEX_SCOPES environment value into a clean list of
 * OAuth scope strings, tolerating every common way someone might paste a
 * scope list into the local environment file:
 *
 *   WEBEX_SCOPES=spark:people_read spark:messages_write
 *   WEBEX_SCOPES=spark:people_read,spark:messages_write
 *   WEBEX_SCOPES="spark:people_read spark:messages_write"
 *   WEBEX_SCOPES='spark:people_read, spark:messages_write'
 *
 * The normalized list is what actually gets sent to Webex — never the
 * raw string — so stray quotes, commas, or duplicate scopes can never
 * reach the `/authorize` request and trigger `invalid_scope`.
 */
export function normalizeScopes(raw: string | undefined | null): string[] {
  if (!raw) return [];

  let value = raw.trim();

  // Tolerate someone pasting the whole "WEBEX_SCOPES=..." line by mistake.
  value = value.replace(/^WEBEX_SCOPES\s*=\s*/i, "").trim();

  // Strip one or more layers of matching surrounding quotes.
  while (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1).trim();
  }

  const seen = new Set<string>();
  const scopes: string[] = [];

  for (const rawToken of value.split(/[,\s]+/)) {
    // Strip any stray quotes left around an individual token (e.g. a
    // comma-separated list where each item was individually quoted).
    const token = rawToken.trim().replace(/^['"]+|['"]+$/g, "");
    if (!token) continue;
    if (token.toLowerCase() === "undefined" || token.toLowerCase() === "null") continue;
    if (seen.has(token)) continue;
    seen.add(token);
    scopes.push(token);
  }

  return scopes;
}

/** Space-separated scope parameter, exactly as the OAuth `scope`
 * query/body parameter expects — URL-encoded exactly once by
 * URLSearchParams when this string is later passed to `.set("scope", ...)`. */
export function scopesToParam(scopes: string[]): string {
  return scopes.join(" ");
}
