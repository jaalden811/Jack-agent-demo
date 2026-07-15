import { describe, expect, it } from "vitest";
import { parseOrganizationEntities, extractOrganizationClaims } from "@/lib/account-resolution/organizationEntityParser";

const PRODUCT_STOPLIST = ["splunk", "splunk enterprise security", "servicenow", "cisco", "thousandeyes", "retailconnect"];
const PARTICIPANTS = ["rachel", "daniel", "jordan", "maya", "eric"];

function orgNames(sentences: string[]): string[] {
  return parseOrganizationEntities(sentences, { productStoplist: PRODUCT_STOPLIST, participantFirstNames: PARTICIPANTS }).organization_candidates.map((c) => c.name);
}

describe("parseOrganizationEntities — entity extraction is separate from claim polarity (primary defect)", () => {
  it("Test 1: an explicit organization inside a NEGATED commercial claim still produces a candidate", () => {
    const names = orgNames(["Please don't leave this meeting saying CONTOSO is running a SIEM competition."]);
    expect(names).toContain("CONTOSO");
  });

  it("Test 2: the negated SIEM-competition claim itself is recorded as negated / false", () => {
    const claims = extractOrganizationClaims(["Please don't leave this meeting saying CONTOSO is running a SIEM competition."]);
    const siem = claims.find((c) => c.type === "siem_competition");
    expect(siem?.classification).toBe("negated");
    expect(siem?.value).toBe(false);
  });

  it("extracts an org from a company-context phrase (at / our client)", () => {
    expect(orgNames(["We do a lot of work at Contoso Global these days."])).toContain("Contoso Global");
    expect(orgNames(["Our client Northgate Materials Inc. is expanding."])).toContain("Northgate Materials Inc");
  });

  it("Test 6: product/vendor names are rejected as account candidates", () => {
    expect(orgNames(["We use Splunk and ServiceNow, and evaluated Splunk Enterprise Security."])).toEqual([]);
  });

  it("Test 7: internal service/app/environment/namespace names are rejected", () => {
    expect(orgNames(["We are migrating RetailConnect to AKS in the commerce-prd-us2 namespace."])).toEqual([]);
  });

  it("common capitalized words and tech-discipline acronyms are not organizations", () => {
    expect(orgNames(["Security is a concern and Procurement is slow; we consolidate SIEM and UEBA and use SRE practices."])).toEqual([]);
    // A month after a context prefix is still rejected.
    expect(orgNames(["The incident happened at May month-end."]).includes("May")).toBe(false);
  });

  it("a known participant's first name is treated as a person, not an org", () => {
    expect(orgNames(["Our client Rachel is not a company."]).includes("Rachel")).toBe(false);
  });

  it("Test 5: generic placeholders are rejected", () => {
    expect(orgNames(["Our client Demo Account is here."])).toEqual([]);
  });
});
