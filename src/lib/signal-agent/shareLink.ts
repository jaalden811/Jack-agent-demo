import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { getConfig } from "@/lib/config";

/**
 * Signs and verifies the read-only share token for
 * /signal-agent/results/[runId]?token=... — an HMAC over the run ID and
 * expiry, using SIGNAL_SHARE_LINK_SECRET. The payload is JSON-encoded
 * (never a naive delimiter split) so a run ID or ISO timestamp
 * containing "." or ":" can never corrupt parsing. Never encodes
 * anything other than the run ID and expiry; never includes secrets or
 * transcript content in the token itself.
 */

function getSecret(): string {
  const configured = getConfig().SIGNAL_SHARE_LINK_SECRET;
  if (configured) return configured;
  // Local-dev fallback only — a link signed with this ephemeral,
  // process-local secret is still safe (read-only, expiring), but is
  // never guaranteed stable across restarts. Configuring
  // SIGNAL_SHARE_LINK_SECRET is required for a durable deployment.
  return devFallbackSecret();
}

let cachedDevSecret: string | null = null;
function devFallbackSecret(): string {
  if (!cachedDevSecret) cachedDevSecret = randomBytes(32).toString("hex");
  return cachedDevSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function signRunToken(runId: string, expiresAtIso: string): string {
  const payload = JSON.stringify({ runId, expiresAt: expiresAtIso });
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url");
  const signature = sign(payload);
  return `${encodedPayload}.${signature}`;
}

export type TokenVerificationReason = "ok" | "malformed" | "signature_mismatch" | "expired";
export type TokenVerification = { valid: boolean; reason: TokenVerificationReason; expiresAt: string | null };

export function verifyRunToken(runId: string, token: string): TokenVerification {
  const separatorIndex = token.indexOf(".");
  if (separatorIndex === -1) return { valid: false, reason: "malformed", expiresAt: null };

  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return { valid: false, reason: "malformed", expiresAt: null };
  }

  let parsed: { runId?: string; expiresAt?: string };
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { valid: false, reason: "malformed", expiresAt: null };
  }

  if (!parsed.runId || !parsed.expiresAt || parsed.runId !== runId) {
    return { valid: false, reason: "malformed", expiresAt: null };
  }

  const expectedSignature = sign(payload);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { valid: false, reason: "signature_mismatch", expiresAt: null };
  }

  const expiresAtMs = new Date(parsed.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs < Date.now()) {
    return { valid: false, reason: "expired", expiresAt: parsed.expiresAt };
  }

  return { valid: true, reason: "ok", expiresAt: parsed.expiresAt };
}
