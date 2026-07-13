import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";
import { GET as statusGet } from "@/app/api/webex/status/route";
import { writeTokenRecord, writeIdentityRecord } from "@/lib/webex/store";

let isolate: { cleanup: () => void };

beforeEach(() => {
  isolate = useIsolatedDataDir();
});

afterEach(() => {
  isolate.cleanup();
});

const SECRET_LOOKING_STRINGS = ["AT-super-secret-access-token", "RT-super-secret-refresh-token", "client-secret-value", "bot-token-value"];

describe("GET /api/webex/status — no secrets ever leak", () => {
  it("never returns the access token, refresh token, or any configured secret", async () => {
    await writeTokenRecord({
      accessToken: SECRET_LOOKING_STRINGS[0],
      refreshToken: SECRET_LOOKING_STRINGS[1],
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshExpiresAt: null,
      scope: "meeting:transcripts_read",
      obtainedAt: new Date().toISOString(),
      lastRefreshedAt: null,
      lastRefreshError: null
    });
    await writeIdentityRecord({ personId: "p-1", displayName: "Test User", email: "test@example.com", cachedAt: new Date().toISOString() });

    process.env.WEBEX_CLIENT_SECRET = SECRET_LOOKING_STRINGS[2];
    process.env.WEBEX_BOT_ACCESS_TOKEN = SECRET_LOOKING_STRINGS[3];

    const response = await statusGet();
    const text = await response.text();

    for (const secret of SECRET_LOOKING_STRINGS) {
      expect(text).not.toContain(secret);
    }
    expect(text.toLowerCase()).not.toContain("accesstoken");
    expect(text.toLowerCase()).not.toContain("refreshtoken");
    expect(text.toLowerCase()).not.toContain("clientsecret");

    delete process.env.WEBEX_CLIENT_SECRET;
    delete process.env.WEBEX_BOT_ACCESS_TOKEN;
  });

  it("reports connected: true with only display name/email, never raw identity or token fields", async () => {
    await writeTokenRecord({
      accessToken: "AT-1",
      refreshToken: "RT-1",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshExpiresAt: null,
      scope: "meeting:transcripts_read spark:people_read",
      obtainedAt: new Date().toISOString(),
      lastRefreshedAt: null,
      lastRefreshError: null
    });
    await writeIdentityRecord({ personId: "p-1", displayName: "Test User", email: "test@example.com", cachedAt: new Date().toISOString() });

    const response = await statusGet();
    const data = await response.json();
    expect(data.connected).toBe(true);
    expect(data.connected_user).toEqual({ name: "Test User", email: "test@example.com" });
    expect(data.granted_scopes).toEqual(["meeting:transcripts_read", "spark:people_read"]);
    expect(data).not.toHaveProperty("accessToken");
    expect(data).not.toHaveProperty("refreshToken");
  });
});
