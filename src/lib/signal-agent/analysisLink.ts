import { getConfig } from "@/lib/config";
import { validatePublicBaseUrl, validateConstructedUrl } from "@/lib/signal-agent/publicUrl";
import { signRunToken } from "@/lib/signal-agent/shareLink";
import { persistRunResult } from "@/lib/signal-agent/resultStore";
import type { AnalysisLink, PersistedRunRecord } from "@/lib/qualification/types";

/**
 * Builds the "Open full analysis" link exactly per the checklist in
 * Section 11: confirm APP_PUBLIC_BASE_URL exists, is HTTPS, and is not
 * localhost/private; confirm the result was persisted; construct and
 * internally re-validate the signed URL; only then include it. Never
 * derives a link from the request Host header or the browser's current
 * origin — the caller (webex/automation.ts) never passes those in.
 */
export async function buildAnalysisLink(record: Omit<PersistedRunRecord, "expires_at">): Promise<AnalysisLink> {
  const config = getConfig();

  // Step 1-3: confirm a real public HTTPS, non-local base URL.
  const baseUrlCheck = validatePublicBaseUrl(config.APP_PUBLIC_BASE_URL);
  if (!baseUrlCheck.valid) {
    return { included: false, url: null, reason: baseUrlCheck.reason === "no_public_base_url" ? "no_public_base_url" : "validation_failed", expires_at: null };
  }

  const ttlHours = config.SIGNAL_SHARE_LINK_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  // Step 4: persist the result before any link is ever constructed.
  const persistResult = await persistRunResult({ ...record, expires_at: expiresAt });
  if (!persistResult.persisted) {
    return { included: false, url: null, reason: "persistence_failed", expires_at: null };
  }

  // Step 5: construct the signed URL.
  const token = signRunToken(record.run_id, expiresAt);
  const base = config.APP_PUBLIC_BASE_URL!.replace(/\/$/, "");
  const url = `${base}/signal-agent/results/${encodeURIComponent(record.run_id)}?token=${encodeURIComponent(token)}`;

  // Step 6: validate the fully-constructed URL internally (defense in
  // depth even though the base URL already passed step 1-3).
  const finalCheck = validateConstructedUrl(url);
  if (!finalCheck.valid) {
    return { included: false, url: null, reason: "validation_failed", expires_at: null };
  }

  // Step 7: all checks passed.
  return { included: true, url, reason: "public_url_ready", expires_at: expiresAt };
}
