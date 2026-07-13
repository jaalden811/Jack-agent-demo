import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsolatedDataDir } from "@/lib/webex/testUtils";

vi.mock("@/lib/outlook/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/outlook/client")>("@/lib/outlook/client");
  return { ...actual, sendMail: vi.fn() };
});

import { sendMail } from "@/lib/outlook/client";
import { writeTokenRecord } from "@/lib/outlook/store";
import { POST as testEmailPost } from "@/app/api/outlook/test-email/route";
import { POST as sendPost } from "@/app/api/outlook/send/route";

let isolate: { cleanup: () => void };

beforeEach(() => {
  isolate = useIsolatedDataDir();
  vi.mocked(sendMail).mockReset();
});

afterEach(() => {
  isolate.cleanup();
});

async function connectOutlook() {
  await writeTokenRecord({
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

describe("POST /api/outlook/test-email", () => {
  it("loads Bella's email from the routing JSON and sends a test email", async () => {
    await connectOutlook();
    vi.mocked(sendMail).mockResolvedValue({ accepted: true, statusCode: 202 });

    const request = new Request("http://localhost/api/outlook/test-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lane: "sales" })
    });
    const response = await testEmailPost(request);
    const data = await response.json();
    expect(data.accepted).toBe(true);
    expect(data.recipient_email).toBe("belrobin@cisco.com");
  });

  it("loads Jack's email from the routing JSON for the technical lane", async () => {
    await connectOutlook();
    vi.mocked(sendMail).mockResolvedValue({ accepted: true, statusCode: 202 });
    const request = new Request("http://localhost/api/outlook/test-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lane: "technical" })
    });
    const response = await testEmailPost(request);
    const data = await response.json();
    expect(data.recipient_email).toBe("jaalden@cisco.com");
  });
});

describe("POST /api/outlook/send", () => {
  it("records HTTP 202 from Microsoft Graph as accepted", async () => {
    await connectOutlook();
    vi.mocked(sendMail).mockResolvedValue({ accepted: true, statusCode: 202 });
    const request = new Request("http://localhost/api/outlook/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toEmail: "test@example.com", subject: "s", html: "<p>h</p>", text: "t" })
    });
    const response = await sendPost(request);
    const data = await response.json();
    expect(data.accepted).toBe(true);
    expect(data.status_code).toBe(202);
  });

  it("returns accepted:false without throwing when Outlook is not connected", async () => {
    const request = new Request("http://localhost/api/outlook/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toEmail: "test@example.com", subject: "s", html: "<p>h</p>", text: "t" })
    });
    const response = await sendPost(request);
    const data = await response.json();
    expect(data.accepted).toBe(false);
    expect(data.error).toBeTruthy();
  });
});
