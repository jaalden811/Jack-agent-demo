import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/research/route";
import { POST as RERUN_POST } from "@/app/api/research/[runId]/rerun/route";

vi.mock("openai", () => ({ default: vi.fn() }));

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
  it("creates a run using new BuyerTarget shape — no email field on buyers", async () => {
    const formData = new FormData();
    formData.set("ciscoProduct", "Cisco Meraki");
    formData.set("targetMarket", "mid-market retail");
    formData.set("maxResults", "2");

    const response = await POST(
      new Request("http://localhost/api/research", { method: "POST", body: formData })
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    // Account names must be valid org names
    const { isValidOrganizationName } = await import("@/lib/services");
    for (const account of json.accounts) {
      expect(isValidOrganizationName(account.companyName)).toBe(true);
    }
    // Buyer shape: no email fields
    const champion = json.accounts[0]?.businessChampion;
    expect(champion?.roleTitle).toBeTruthy();
    expect("businessEmail" in champion).toBe(false);
  });

  it("returns fallback/unverified run when provider keys are missing", async () => {
    const formData = new FormData();
    formData.set("ciscoProduct", "Cisco XDR");
    formData.set("targetMarket", "healthcare");
    formData.set("maxResults", "2");
    formData.set("seedAccounts", "Example Health System");

    const response = await POST(
      new Request("http://localhost/api/research", { method: "POST", body: formData })
    );
    const json = await response.json();
    expect(json.isFallback).toBe(true);
    expect(json.providerStatus.fallbackModeActive).toBe(true);
    expect(json.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("SEARCH_API_KEY")])
    );
  });

  it("reruns a fallback run — new run id, same input", async () => {
    const formData = new FormData();
    formData.set("ciscoProduct", "Cisco Secure Firewall");
    formData.set("targetMarket", "state/local government");
    formData.set("maxResults", "1");
    formData.set("seedAccounts", "Example County");

    const createResponse = await POST(
      new Request("http://localhost/api/research", { method: "POST", body: formData })
    );
    const original = await createResponse.json();

    const rerunResponse = await RERUN_POST(
      new Request("http://localhost/api/research/rerun", { method: "POST" }),
      { params: Promise.resolve({ runId: original.id }) }
    );
    const rerun = await rerunResponse.json();
    expect(rerunResponse.status).toBe(200);
    expect(rerun.id).not.toBe(original.id);
    expect(rerun.input.ciscoProduct).toBe(original.input.ciscoProduct);
  });
});
