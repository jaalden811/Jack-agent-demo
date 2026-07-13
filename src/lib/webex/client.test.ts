import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, verifyWebhookSignature } from "@/lib/webex/client";
import { createHmac } from "node:crypto";

describe("buildAuthorizeUrl", () => {
  it("builds a Webex OAuth authorize URL with client_id, redirect_uri, scope, and state", () => {
    const url = buildAuthorizeUrl({
      clientId: "abc123",
      redirectUri: "http://localhost:3010/api/webex/oauth/callback",
      scopes: ["meeting:transcripts_read", "spark:people_read"],
      state: "state-xyz"
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://webexapis.com/v1/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("abc123");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3010/api/webex/oauth/callback");
    expect(parsed.searchParams.get("scope")).toBe("meeting:transcripts_read spark:people_read");
    expect(parsed.searchParams.get("state")).toBe("state-xyz");
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a correctly computed HMAC-SHA1 signature", () => {
    const secret = "shared-secret";
    const rawBody = JSON.stringify({ id: "evt-1", resource: "meetingTranscripts", event: "created" });
    const signature = createHmac("sha1", secret).update(rawBody).digest("hex");
    expect(verifyWebhookSignature(secret, rawBody, signature)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const secret = "shared-secret";
    const rawBody = JSON.stringify({ id: "evt-1" });
    const signature = createHmac("sha1", secret).update(rawBody).digest("hex");
    expect(verifyWebhookSignature(secret, `${rawBody}tampered`, signature)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature("secret", "{}", null)).toBe(false);
  });
});
