import { describe, expect, it } from "vitest";
import { ingestTranscript } from "@/lib/signal-agent/transcript";
import { classifyOwnership, extractNamedStakeholders, inferFunctionalOwners } from "@/lib/signal-agent/stakeholderExtraction";

describe("extractNamedStakeholders", () => {
  it("detects a named, titled customer participant as an explicit stakeholder", () => {
    const transcript = ingestTranscript(
      ["Daniel Cho — Customer, Reliability Lead", "", "00:00 — Daniel: We are struggling with cross-domain visibility."].join("\n")
    );
    const stakeholders = extractNamedStakeholders(transcript);
    expect(stakeholders).toHaveLength(1);
    expect(stakeholders[0].name).toBe("Daniel Cho");
    expect(stakeholders[0].tier).toBe("explicit");
    expect(stakeholders[0].ownership_type).toBe("reliability");
    expect(stakeholders[0].evidence).toContain("cross-domain visibility");
  });

  it("never includes a vendor (Cisco) participant as a customer stakeholder, regardless of speaking frequency", () => {
    const transcript = ingestTranscript(
      [
        "Maya Chen — Cisco Account Executive",
        "Daniel Cho — Customer, Reliability Lead",
        "",
        "00:00 — Maya: Let's begin.",
        "00:01 — Maya: Moving to the next topic.",
        "00:02 — Maya: One more thing before we continue.",
        "00:03 — Daniel: We need better visibility."
      ].join("\n")
    );
    const stakeholders = extractNamedStakeholders(transcript);
    expect(stakeholders.map((s) => s.name)).not.toContain("Maya Chen");
    expect(stakeholders.map((s) => s.name)).toContain("Daniel Cho");
  });

  it("classifies distinct customer functions correctly (reliability, security architecture, finance)", () => {
    const transcript = ingestTranscript(
      [
        "Daniel Cho — Customer, Reliability Lead",
        "Priya Nair — Customer, Security Architecture Lead",
        "Erin Walsh — Customer, Finance and Vendor Management",
        "",
        "00:00 — Daniel: Reliability is our top concern.",
        "00:01 — Priya: We need security architecture sign-off.",
        "00:02 — Erin: Finance estimated significant delayed-order impact."
      ].join("\n")
    );
    const stakeholders = extractNamedStakeholders(transcript);
    const byName = new Map(stakeholders.map((s) => [s.name, s]));
    expect(byName.get("Daniel Cho")?.ownership_type).toBe("reliability");
    expect(byName.get("Priya Nair")?.ownership_type).toBe("security_architecture");
    expect(byName.get("Erin Walsh")?.ownership_type).toBe("finance_vendor_management");
  });

  it("never fabricates a name — a participant with no title and no dialogue turns is excluded", () => {
    const transcript = ingestTranscript(
      ["Participants: Ghost Attendee (Customer)", "", "00:00 — Daniel: We have a real issue to discuss."].join("\n")
    );
    const stakeholders = extractNamedStakeholders(transcript);
    expect(stakeholders.some((s) => s.name === "Ghost Attendee")).toBe(false);
  });
});

describe("inferFunctionalOwners", () => {
  it("infers a functional owner from generic organizational-function language without naming a person", () => {
    const transcript = ingestTranscript(
      "00:00 — Daniel: This will need sign-off from the enterprise architecture review board before we proceed."
    );
    const owners = inferFunctionalOwners(transcript, []);
    expect(owners.some((o) => o.function_or_role === "Enterprise Architecture")).toBe(true);
    const owner = owners.find((o) => o.function_or_role === "Enterprise Architecture")!;
    expect(owner.name).toBeNull();
    expect(owner.tier).toBe("inferred_functional");
  });

  it("does not fabricate a person's name for an inferred functional owner", () => {
    const transcript = ingestTranscript("00:00 — Daniel: The security operations team will need to review this.");
    const owners = inferFunctionalOwners(transcript, []);
    expect(owners.every((o) => o.name === null)).toBe(true);
  });

  it("lowers confidence for a function that is already covered by a named stakeholder", () => {
    const transcript = ingestTranscript(
      [
        "Daniel Cho — Customer, Reliability Lead",
        "",
        "00:00 — Daniel: Reliability is our top concern.",
        "00:01 — Daniel: The reliability team will also need to weigh in separately."
      ].join("\n")
    );
    const named = extractNamedStakeholders(transcript);
    const owners = inferFunctionalOwners(transcript, named);
    // Reliability already has a named owner (Daniel), so any inferred
    // "Platform Reliability" function mention should carry lower confidence.
    const reliabilityOwner = owners.find((o) => o.function_or_role === "Platform Reliability");
    if (reliabilityOwner) {
      expect(reliabilityOwner.confidence).toBeLessThan(0.5);
    }
  });
});

describe("classifyOwnership", () => {
  it("classifies new ownership types introduced by this repair", () => {
    expect(classifyOwnership("Reliability Lead")).toBe("reliability");
    expect(classifyOwnership("Enterprise Architecture Lead")).toBe("enterprise_architecture");
    expect(classifyOwnership("Security Architecture Lead")).toBe("security_architecture");
    expect(classifyOwnership("Cloud Platform Engineering")).toBe("cloud_platform");
    expect(classifyOwnership("Finance and Vendor Management")).toBe("finance_vendor_management");
    expect(classifyOwnership("IT Service Management")).toBe("itsm");
    expect(classifyOwnership("Infrastructure Lead")).toBe("infrastructure");
  });
});
