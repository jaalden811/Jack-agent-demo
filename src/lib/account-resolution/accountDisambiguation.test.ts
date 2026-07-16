import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccountWithDisambiguation } from "@/lib/account-resolution/accountResolver";
import type { AccountResolutionInputs } from "@/lib/account-resolution/types";
import * as client from "@/lib/connectors/serpapi/client";

function baseInputs(overrides: Partial<AccountResolutionInputs> = {}): AccountResolutionInputs {
  return {
    transcriptAccountField: null,
    userEnteredAccount: null,
    uploadedAccountRecord: null,
    crmMatch: null,
    webexMeetingTitle: null,
    outlookEventSubject: null,
    customerParticipantEmailDomains: [],
    transcriptDialogueText: [],
    aiAccountCandidates: [],
    ...overrides
  };
}

describe("resolveAccountWithDisambiguation (Section 2)", () => {
  const originalKey = process.env.SEARCH_API_KEY;
  const originalProvider = process.env.SEARCH_PROVIDER;

  beforeEach(() => {
    process.env.SEARCH_API_KEY = "test-serpapi-key";
    process.env.SEARCH_PROVIDER = "serpapi";
  });
  afterEach(() => {
    process.env.SEARCH_API_KEY = originalKey;
    process.env.SEARCH_PROVIDER = originalProvider;
    vi.restoreAllMocks();
  });

  it("never runs disambiguation for a confirmed account", async () => {
    const spy = vi.spyOn(client, "executeSerpApiSearch");
    const result = await resolveAccountWithDisambiguation(baseInputs({ transcriptAccountField: "Meridian Health Systems" }));
    expect(result.status).toBe("confirmed");
    expect(spy).not.toHaveBeenCalled();
  });

  it("never runs disambiguation for an unresolved account", async () => {
    const spy = vi.spyOn(client, "executeSerpApiSearch");
    const result = await resolveAccountWithDisambiguation(baseInputs());
    expect(result.status).toBe("unresolved");
    expect(spy).not.toHaveBeenCalled();
  });

  it("upgrades a probable candidate to confirmed when a single high-authority source confirms it", async () => {
    vi.spyOn(client, "executeSerpApiSearch").mockResolvedValue({
      organic_results: [{ title: "Acme Corp announces new headquarters", link: "https://www.businesswire.com/news/acme-corp-hq", snippet: "Acme Corp, headquartered in Denver, announced today." }]
    });
    const result = await resolveAccountWithDisambiguation(baseInputs({ webexMeetingTitle: "Acme Corp Discovery" }));
    expect(result.status).toBe("confirmed");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.source).toBe("combined");
  });

  it("does not upgrade when disambiguation results point to conflicting high-authority domains", async () => {
    vi.spyOn(client, "executeSerpApiSearch").mockResolvedValue({
      organic_results: [
        { title: "Acme Corp (widgets division)", link: "https://www.reuters.com/acme-widgets", snippet: "A widgets-focused Acme Corp." },
        { title: "Acme Corp (logistics division)", link: "https://www.bloomberg.com/acme-logistics", snippet: "A completely different, unrelated Acme Corp." }
      ]
    });
    const result = await resolveAccountWithDisambiguation(baseInputs({ webexMeetingTitle: "Acme Corp Discovery" }));
    expect(result.status).not.toBe("confirmed");
  });

  it("degrades gracefully when SerpAPI is not configured, leaving the base probable result intact", async () => {
    delete process.env.SEARCH_API_KEY;
    const result = await resolveAccountWithDisambiguation(baseInputs({ webexMeetingTitle: "Acme Corp Discovery" }));
    expect(result.status).toBe("probable");
    expect(result.issues.some((i) => i.includes("disambiguation not run"))).toBe(true);
  });
});
