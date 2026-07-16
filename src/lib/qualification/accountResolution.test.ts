import { describe, expect, it } from "vitest";
import { resolveAccountIdentity, type AccountResolutionInput } from "@/lib/qualification/accountResolution";

function baseInput(overrides: Partial<AccountResolutionInput> = {}): AccountResolutionInput {
  return {
    transcriptAccountLine: null,
    transcriptAccountMatchedInCrm: false,
    userEnteredAccount: null,
    webexMeetingTitle: null,
    outlookCalendarSubject: null,
    attendeeEmailDomains: [],
    uploadedAccountContextName: null,
    dialogueMentionedCompany: null,
    aiAccountCandidates: [],
    ...overrides
  };
}

describe("resolveAccountIdentity — Section 2/7 priority order and generic-name blocking", () => {
  it("returns unresolved with an action_required when there is no real evidence", async () => {
    const result = await resolveAccountIdentity(baseInput());
    expect(result.status).toBe("unresolved");
    expect(result.name).toBeNull();
    expect(result.action_required).toBeTruthy();
  });

  it("never resolves a generic transcript account line ('Unknown', 'Demo Account', etc.)", async () => {
    const result = await resolveAccountIdentity(baseInput({ transcriptAccountLine: "Demo Account" }));
    expect(result.status).toBe("unresolved");
  });

  it("resolves with high confidence when the transcript account line matches a real CRM account", async () => {
    const result = await resolveAccountIdentity(baseInput({ transcriptAccountLine: "Meridian Health Systems", transcriptAccountMatchedInCrm: true }));
    expect(result.status).toBe("confirmed");
    expect(result.source).toBe("crm");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("prefers the explicit transcript account line over a Webex meeting title", async () => {
    const result = await resolveAccountIdentity(
      baseInput({ transcriptAccountLine: "Meridian Health Systems", transcriptAccountMatchedInCrm: true, webexMeetingTitle: "Acme Corp Discovery Call" })
    );
    expect(result.name).toBe("Meridian Health Systems");
  });

  it("falls back to a probable match from the Webex meeting title when no transcript account line exists", async () => {
    const result = await resolveAccountIdentity(baseInput({ webexMeetingTitle: "Acme Corp Discovery" }));
    expect(result.status).toBe("probable");
    expect(result.name).toContain("Acme Corp");
  });

  it("surfaces AI-extracted candidates as alternatives even when a higher-priority source resolves the account", async () => {
    const result = await resolveAccountIdentity(
      baseInput({
        transcriptAccountLine: "Meridian Health Systems",
        transcriptAccountMatchedInCrm: true,
        aiAccountCandidates: [{ name: "Meridian Health Partners", domain: null, confidence: 0.4, evidence_ids: [] }]
      })
    );
    expect(result.alternatives.some((a) => a.name === "Meridian Health Partners")).toBe(true);
  });

  it("never claims confirmed status for a low-confidence dialogue mention alone", async () => {
    const result = await resolveAccountIdentity(baseInput({ dialogueMentionedCompany: "Acme Widgets" }));
    expect(result.status).not.toBe("confirmed");
  });
});
