import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/research/route";
import { POST as RERUN_POST } from "@/app/api/research/[runId]/rerun/route";

vi.mock("openai", () => ({
  default: vi.fn()
}));

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.SEARCH_API_KEY;
  process.env.SEARCH_PROVIDER = "tavily";
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.HUNTER_API_KEY;
  delete process.env.PEOPLE_DATA_LABS_API_KEY;
  delete process.env.CLEARBIT_API_KEY;
});

describe("POST /api/research", () => {
  it("creates a run with seed accounts and missing-provider warnings", async () => {
    const formData = new FormData();
    formData.set("ciscoProduct", "Cisco Meraki");
    formData.set("targetMarket", "mid-market retail");
    formData.set("maxResults", "1");
    formData.set("seedAccounts", "Example Retail Group");

    const request = new Request("http://localhost/api/research", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.accounts[0].companyName).toBe("Example Retail Group");
    expect(json.accounts[0].champion.businessEmail).toBeNull();
    expect(json.isFallback).toBe(true);
    expect(json.providerStatus.fallbackModeActive).toBe(true);
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("SEARCH_API_KEY"),
        expect.stringContaining("contact enrichment")
      ])
    );
  });

  it("reruns a fallback run without overwriting the original run", async () => {
    const formData = new FormData();
    formData.set("ciscoProduct", "Cisco Secure Firewall");
    formData.set("targetMarket", "state/local government");
    formData.set("maxResults", "1");
    formData.set("seedAccounts", "Example County");

    const createResponse = await POST(
      new Request("http://localhost/api/research", {
        method: "POST",
        body: formData
      })
    );
    const original = await createResponse.json();

    const rerunResponse = await RERUN_POST(new Request("http://localhost/api/research/rerun", { method: "POST" }), {
      params: Promise.resolve({ runId: original.id })
    });
    const rerun = await rerunResponse.json();
    expect(rerunResponse.status).toBe(200);
    expect(rerun.id).not.toBe(original.id);
    expect(rerun.input.ciscoProduct).toBe(original.input.ciscoProduct);
    expect(rerun.isFallback).toBe(true);
  });
});
