import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/research/route";

vi.mock("openai", () => ({
  default: vi.fn()
}));

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
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("SEARCH_API_KEY"),
        expect.stringContaining("contact enrichment")
      ])
    );
  });
});
