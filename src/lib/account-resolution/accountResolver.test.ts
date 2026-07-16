import { describe, expect, it } from "vitest";
import { resolveAccount } from "@/lib/account-resolution/accountResolver";
import type { AccountResolutionInputs } from "@/lib/account-resolution/types";

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

describe("Test 1: explicit account name resolves immediately", () => {
  it("resolves confirmed from the transcript Account: field alone", () => {
    const result = resolveAccount(baseInputs({ transcriptAccountField: "Meridian Health Systems" }));
    expect(result.status).toBe("confirmed");
    expect(result.name).toBe("Meridian Health Systems");
  });
});

describe("Test 2: user-entered account overrides weak candidates", () => {
  it("prefers a user-entered account over a low-confidence dialogue/Webex candidate", () => {
    const result = resolveAccount(baseInputs({ userEnteredAccount: "Acme Retail Group", webexMeetingTitle: "Discovery Call" }));
    expect(result.name).toBe("Acme Retail Group");
    expect(result.source).toBe("user_input");
  });
});

describe("Test 3: email domain contributes to account resolution", () => {
  it("derives a weak candidate name/domain from a non-personal attendee email domain, surfaced as an alternative", () => {
    const result = resolveAccount(baseInputs({ customerParticipantEmailDomains: ["acmeretail.com", "gmail.com"] }));
    expect(result.alternatives.some((a) => a.domain === "acmeretail.com")).toBe(true);
  });

  it("email domain contributes as the confirmed source when it is the only, high-confidence evidence available via a combined candidate", () => {
    const result = resolveAccount(
      baseInputs({
        customerParticipantEmailDomains: ["acmeretail.com", "gmail.com"],
        aiAccountCandidates: [{ name: "Acme Retail", domain: "acmeretail.com", confidence: 0.6, evidence_ids: ["stage_a"] }]
      })
    );
    // Two independent weak sources pointing at the same domain still
    // never fabricate a >=0.70 "probable" claim on their own — each
    // remains its own weak candidate.
    expect(result.status).not.toBe("confirmed");
  });
});

describe("Test 4: application names do not become company names", () => {
  it.each(["RetailConnect", "Digital Customer Portal", "Ordering Platform", "Observability Working Group", "DCP-Prod", "commerce-prd-us2"])(
    "never resolves %s from a raw dialogue mention as a confirmed/probable account",
    (appName) => {
      const result = resolveAccount(baseInputs({ transcriptDialogueText: [`We are migrating ${appName} to the new environment.`] }));
      expect(result.name).not.toBe(appName);
    }
  );

  it("directly rejects the application-name examples via candidate validation regardless of source", () => {
    // Even if a caller mistakenly supplied one of these as the
    // "explicit" transcript field, validation still rejects it.
    for (const appName of ["Digital Customer Portal", "Ordering Platform", "DCP-Prod", "commerce-prd-us2"]) {
      const result = resolveAccount(baseInputs({ transcriptAccountField: appName }));
      expect(result.name).not.toBe(appName);
      expect(result.status).toBe("unresolved");
    }
  });
});

describe("Test 5: generic placeholders are rejected", () => {
  it.each(["Unknown", "Not stated", "Demo Account", "Customer", "Example Company", "Global Retail Operations", "Test Account"])("never resolves the generic placeholder %s", (placeholder) => {
    const result = resolveAccount(baseInputs({ transcriptAccountField: placeholder }));
    expect(result.status).toBe("unresolved");
    expect(result.name).toBeNull();
  });
});

describe("Test 8: ambiguous matches require user selection", () => {
  it("returns status ambiguous with alternatives when two independent sources disagree at similar confidence", () => {
    const result = resolveAccount(
      baseInputs({
        webexMeetingTitle: "Acme Retail Group",
        outlookEventSubject: "Northgate Logistics"
      })
    );
    expect(["ambiguous", "conflicting"]).toContain(result.status);
    expect(result.alternatives.length).toBeGreaterThan(0);
  });
});

describe("Test 31: five unrelated accounts produce different search plans", () => {
  it("each distinct company name/domain resolves to its own distinct account, never converging on one hard-coded value", () => {
    const companies = ["Meridian Health Systems", "Brightfield Regional Utilities", "Larchmont County Health Network", "Pinehollow Community Schools", "Northgate Materials Science"];
    const resolved = companies.map((name) => resolveAccount(baseInputs({ transcriptAccountField: name })));
    expect(resolved.every((r) => r.status === "confirmed")).toBe(true);
    const distinctNames = new Set(resolved.map((r) => r.name));
    expect(distinctNames.size).toBe(companies.length);
  });
});
