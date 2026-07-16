import { describe, expect, it } from "vitest";
import { domainMatchesName, isNonCanonicalDomain } from "@/lib/account-resolution/accountDisambiguation";
import { isUsableDomain, isUsableAccount, planExecutivePriorityQueries, planTechnologyAlignmentQueries, planCompetitionQueries, planStrategicObjectiveQueries } from "@/lib/opportunity-fit/signalCatalog";

describe("canonical domain selection (never a third-party aggregator)", () => {
  it("matches a first-party domain to the account name", () => {
    expect(domainMatchesName("aecom.com", "AECOM")).toBe(true);
    expect(domainMatchesName("investors.aecom.com", "AECOM")).toBe(true);
    expect(domainMatchesName("acme.com", "Acme Retail")).toBe(true);
  });
  it("does NOT treat a third-party directory domain as the company domain", () => {
    expect(domainMatchesName("zoominfo.com", "AECOM")).toBe(false);
    expect(domainMatchesName("linkedin.com", "AECOM")).toBe(false);
    expect(isNonCanonicalDomain("zoominfo.com")).toBe(true);
    expect(isNonCanonicalDomain("ie.linkedin.com")).toBe(true);
    expect(isNonCanonicalDomain("aecom.com")).toBe(false);
  });
});

describe("malformed / placeholder query suppression", () => {
  it("rejects placeholder or empty domains", () => {
    expect(isUsableDomain(null)).toBe(false);
    expect(isUsableDomain("")).toBe(false);
    expect(isUsableDomain("site.com")).toBe(false);
    expect(isUsableDomain("example.com")).toBe(false);
    expect(isUsableDomain("aecom.com")).toBe(true);
  });
  it("does not emit a site: query for a placeholder/empty domain", () => {
    const noDomain = planExecutivePriorityQueries("AECOM", null);
    expect(noDomain.some((q) => q.query.includes("site:"))).toBe(false);
    const placeholder = planExecutivePriorityQueries("AECOM", "site.com");
    expect(placeholder.some((q) => q.query.includes("site:"))).toBe(false);
    const real = planExecutivePriorityQueries("AECOM", "aecom.com");
    expect(real.some((q) => q.query === "site:aecom.com strategy technology")).toBe(true);
  });
  it("suppresses ALL queries for a generic/empty account", () => {
    expect(isUsableAccount("Not stated")).toBe(false);
    expect(isUsableAccount("the account")).toBe(false);
    expect(planExecutivePriorityQueries("Not stated", "aecom.com")).toEqual([]);
    expect(planTechnologyAlignmentQueries("", "aecom.com", ["splunk"])).toEqual([]);
    expect(planStrategicObjectiveQueries("Not stated", ["cloud transformation"])).toEqual([]);
    expect(planCompetitionQueries("the account", "aecom.com", ["Splunk"])).toEqual([]);
  });
  it("competition planner never emits a site: query for a placeholder domain", () => {
    const q = planCompetitionQueries("AECOM", "site.com", ["Splunk"]);
    expect(q.some((x) => x.query.includes("site:"))).toBe(false);
  });
});
