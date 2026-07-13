import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";
import { getAutomationReadiness } from "@/lib/webex/automationSettings";
import { writeTokenRecord as writeWebexTokenRecord, writeAutoSendOverride } from "@/lib/webex/store";
import { writeTokenRecord as writeOutlookTokenRecord } from "@/lib/outlook/store";

let isolate: { cleanup: () => void };

beforeEach(() => {
  isolate = useIsolatedDataDir();
});

afterEach(() => {
  isolate.cleanup();
});

async function connectWebex() {
  await writeWebexTokenRecord({
    accessToken: "AT",
    refreshToken: "RT",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshExpiresAt: null,
    scope: "spark:messages_write",
    obtainedAt: new Date().toISOString(),
    lastRefreshedAt: null,
    lastRefreshError: null
  });
}

async function connectOutlook() {
  await writeOutlookTokenRecord({
    accessToken: "MS-AT",
    refreshToken: "MS-RT",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "openid profile offline_access User.Read Mail.Send",
    obtainedAt: new Date().toISOString(),
    lastRefreshedAt: null,
    lastRefreshError: null
  });
}

describe("getAutomationReadiness — auto-send after analysis", () => {
  it("defaults to disabled when neither channel is ready", async () => {
    const readiness = await getAutomationReadiness();
    expect(readiness.autoSendEnabled).toBe(false);
    expect(readiness.autoSendOverridden).toBe(false);
  });

  it("defaults to enabled once both Webex delivery and Outlook Mail.Send are ready", async () => {
    await connectWebex();
    await connectOutlook();
    const readiness = await getAutomationReadiness();
    expect(readiness.webexReady).toBe(true);
    expect(readiness.outlookReady).toBe(true);
    expect(readiness.autoSendEnabled).toBe(true);
  });

  it("an explicit override always wins over the computed default", async () => {
    await connectWebex();
    await connectOutlook();
    await writeAutoSendOverride(false);
    const readiness = await getAutomationReadiness();
    expect(readiness.autoSendEnabled).toBe(false);
    expect(readiness.autoSendOverridden).toBe(true);
  });

  it("can be explicitly disabled even when it would otherwise default to enabled, and re-enabled again", async () => {
    await connectWebex();
    await connectOutlook();
    await writeAutoSendOverride(false);
    expect((await getAutomationReadiness()).autoSendEnabled).toBe(false);
    await writeAutoSendOverride(true);
    expect((await getAutomationReadiness()).autoSendEnabled).toBe(true);
  });
});
