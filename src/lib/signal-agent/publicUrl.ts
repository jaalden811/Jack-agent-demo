/**
 * Validates that a configured base URL is a genuinely public, HTTPS
 * origin — never localhost, a loopback address, or a private-LAN
 * address. Used before building any outbound share link (Webex
 * message, Outlook email) so a link that could never resolve for a
 * remote recipient is never sent.
 */

const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  // 172.16.0.0 – 172.31.255.255
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
  /^fc00:/i,
  /^fd00:/i,
  /^fe80:/i,
  /\.local$/i,
  /\.internal$/i
];

export type PublicUrlCheck = { valid: boolean; reason: string | null };

export function isPrivateOrLocalHostname(hostname: string): boolean {
  return PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
}

/** Validates a full base URL (origin) — must parse, must be HTTPS, and
 * must not resolve to a private/local hostname. */
export function validatePublicBaseUrl(rawUrl: string | undefined | null): PublicUrlCheck {
  if (!rawUrl || !rawUrl.trim()) return { valid: false, reason: "no_public_base_url" };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, reason: "validation_failed" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "validation_failed" };
  }

  if (isPrivateOrLocalHostname(parsed.hostname)) {
    return { valid: false, reason: "validation_failed" };
  }

  return { valid: true, reason: null };
}

/** Final internal validation of a fully-constructed URL before it is
 * ever included in an outbound message — defense in depth even if the
 * base URL passed the check above. */
export function validateConstructedUrl(url: string): PublicUrlCheck {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return { valid: false, reason: "validation_failed" };
    if (isPrivateOrLocalHostname(parsed.hostname)) return { valid: false, reason: "validation_failed" };
    return { valid: true, reason: null };
  } catch {
    return { valid: false, reason: "validation_failed" };
  }
}
