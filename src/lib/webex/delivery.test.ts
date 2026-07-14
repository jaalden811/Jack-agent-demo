import { describe, expect, it, vi, beforeEach } from "vitest";
import { deliverMessages } from "@/lib/webex/delivery";
import type { WebexMessagePreview } from "@/lib/webex/types";

vi.mock("@/lib/webex/client", () => ({
  sendDirectMessage: vi.fn(),
  WebexApiError: class WebexApiError extends Error {}
}));

import { sendDirectMessage } from "@/lib/webex/client";

const salesMessage: WebexMessagePreview = {
  lane: "sales",
  recipient_name: "Bella Robinson",
  recipient_email: "belrobin@cisco.com",
  subject: "Sales action",
  markdown: "**Sales action**",
  character_count: 20,
  synthesized_by_ai: false
};

const technicalMessage: WebexMessagePreview = {
  lane: "technical",
  recipient_name: "Jack Alden",
  recipient_email: "jaalden@cisco.com",
  subject: "Technical action",
  markdown: "**Technical action**",
  character_count: 21,
  synthesized_by_ai: false
};

beforeEach(() => {
  vi.mocked(sendDirectMessage).mockReset();
});

describe("deliverMessages", () => {
  it("sends via toPersonEmail (no room ID) using the connected user's own access token by default", async () => {
    vi.mocked(sendDirectMessage).mockResolvedValue({ id: "msg-123", toPersonEmail: "belrobin@cisco.com" });

    const results = await deliverMessages([salesMessage], { accessToken: "connected-user-token", mode: "connected_user" }, "run-1");

    expect(sendDirectMessage).toHaveBeenCalledWith("connected-user-token", {
      toPersonEmail: "belrobin@cisco.com",
      markdown: "**Sales action**"
    });
    expect(sendDirectMessage).toHaveBeenCalledTimes(1);
    const [, params] = vi.mocked(sendDirectMessage).mock.calls[0];
    expect(params).not.toHaveProperty("roomId");

    expect(results[0].delivered).toBe(true);
    expect(results[0].message_id).toBe("msg-123");
    expect(results[0].channel).toBe("webex");
    expect(results[0].delivery_key).toBe("run-1:sales:webex");
  });

  it("also works with an optional bot token as the sender", async () => {
    vi.mocked(sendDirectMessage).mockResolvedValue({ id: "msg-bot-1", toPersonEmail: "belrobin@cisco.com" });
    const results = await deliverMessages([salesMessage], { accessToken: "bot-token", mode: "bot" }, "run-1");
    expect(sendDirectMessage).toHaveBeenCalledWith("bot-token", { toPersonEmail: "belrobin@cisco.com", markdown: "**Sales action**" });
    expect(results[0].delivered).toBe(true);
  });

  it("one recipient failing does not block the other lane's delivery", async () => {
    vi.mocked(sendDirectMessage).mockImplementation(async (_token, params) => {
      if (params.toPersonEmail === "belrobin@cisco.com") {
        throw new Error("Could not resolve recipient");
      }
      return { id: "msg-technical-456", toPersonEmail: params.toPersonEmail };
    });

    const results = await deliverMessages([salesMessage, technicalMessage], { accessToken: "connected-user-token", mode: "connected_user" }, "run-1");

    const salesResult = results.find((r) => r.lane === "sales")!;
    const technicalResult = results.find((r) => r.lane === "technical")!;

    expect(salesResult.delivered).toBe(false);
    expect(salesResult.error).toBeTruthy();
    expect(technicalResult.delivered).toBe(true);
    expect(technicalResult.message_id).toBe("msg-technical-456");
  });

  it("shows delivery as unavailable (not a crash) when no sender token is available — the bot is never required", async () => {
    const results = await deliverMessages([salesMessage], { accessToken: null, mode: "unavailable" }, "run-1");
    expect(results[0].attempted).toBe(false);
    expect(results[0].delivered).toBe(false);
    expect(results[0].error).toContain("connect Webex");
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });

  it("records an error for a lane with no configured recipient email without touching the other lane", async () => {
    vi.mocked(sendDirectMessage).mockResolvedValue({ id: "msg-technical-789", toPersonEmail: "jaalden@cisco.com" });
    const salesWithoutEmail: WebexMessagePreview = { ...salesMessage, recipient_email: null };

    const results = await deliverMessages([salesWithoutEmail, technicalMessage], { accessToken: "connected-user-token", mode: "connected_user" }, "run-1");

    const salesResult = results.find((r) => r.lane === "sales")!;
    const technicalResult = results.find((r) => r.lane === "technical")!;
    expect(salesResult.attempted).toBe(false);
    expect(salesResult.error).toContain("No recipient email configured");
    expect(technicalResult.delivered).toBe(true);
  });
});
