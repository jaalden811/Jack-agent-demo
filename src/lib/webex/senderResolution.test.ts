import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";
import { resolveWebexSender } from "@/lib/webex/senderResolution";
import { writeTokenRecord } from "@/lib/webex/store";

let isolate: { cleanup: () => void };

beforeEach(() => {
  isolate = useIsolatedDataDir();
});

afterEach(() => {
  isolate.cleanup();
  delete process.env.WEBEX_BOT_ACCESS_TOKEN;
});

describe("resolveWebexSender", () => {
  it("defaults to the connected user's own OAuth token when spark:messages_write is granted", async () => {
    await writeTokenRecord({
      accessToken: "connected-user-token",
      refreshToken: "RT",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshExpiresAt: null,
      scope: "meeting:transcripts_read spark:messages_write",
      obtainedAt: new Date().toISOString(),
      lastRefreshedAt: null,
      lastRefreshError: null
    });

    const sender = await resolveWebexSender();
    expect(sender.mode).toBe("connected_user");
    expect(sender.accessToken).toBe("connected-user-token");
    expect(sender.messageScopeGranted).toBe(true);
  });

  it("falls back to an optional bot token when the connected user lacks spark:messages_write", async () => {
    await writeTokenRecord({
      accessToken: "connected-user-token-no-scope",
      refreshToken: "RT",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshExpiresAt: null,
      scope: "meeting:transcripts_read",
      obtainedAt: new Date().toISOString(),
      lastRefreshedAt: null,
      lastRefreshError: null
    });
    process.env.WEBEX_BOT_ACCESS_TOKEN = "fallback-bot-token";

    const sender = await resolveWebexSender();
    expect(sender.mode).toBe("bot");
    expect(sender.accessToken).toBe("fallback-bot-token");
  });

  it("is unavailable (not a crash) when there is no connected user and no bot token — the bot is never required", async () => {
    const sender = await resolveWebexSender();
    expect(sender.mode).toBe("unavailable");
    expect(sender.accessToken).toBeNull();
  });
});
