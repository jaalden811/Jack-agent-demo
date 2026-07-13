import { describe, expect, it } from "vitest";
import { normalizeScopes, scopesToParam } from "@/lib/webex/scopes";

describe("normalizeScopes", () => {
  it("parses space-separated scopes", () => {
    expect(normalizeScopes("spark:people_read spark:messages_write")).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("parses comma-separated scopes", () => {
    expect(normalizeScopes("spark:people_read,spark:messages_write")).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("parses comma-and-space-separated scopes", () => {
    expect(normalizeScopes("spark:people_read, spark:messages_write")).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("strips a surrounding double-quoted value", () => {
    expect(normalizeScopes('"spark:people_read spark:messages_write"')).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("strips a surrounding single-quoted value", () => {
    expect(normalizeScopes("'spark:people_read spark:messages_write'")).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("strips stray quotes around individual comma-separated tokens", () => {
    expect(normalizeScopes('"spark:people_read","spark:messages_write"')).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("removes duplicate scopes", () => {
    expect(normalizeScopes("spark:people_read spark:people_read spark:messages_write")).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("removes empty tokens from extra whitespace/commas", () => {
    expect(normalizeScopes("spark:people_read,  ,spark:messages_write,,")).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("tolerates the literal 'WEBEX_SCOPES=' prefix being pasted into the value", () => {
    expect(normalizeScopes("WEBEX_SCOPES=spark:people_read spark:messages_write")).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("drops the literal string 'undefined'", () => {
    expect(normalizeScopes("spark:people_read undefined spark:messages_write")).toEqual(["spark:people_read", "spark:messages_write"]);
  });

  it("returns an empty array for empty/undefined input", () => {
    expect(normalizeScopes("")).toEqual([]);
    expect(normalizeScopes(undefined)).toEqual([]);
    expect(normalizeScopes(null)).toEqual([]);
  });

  it("handles newlines the same as other whitespace", () => {
    expect(normalizeScopes("spark:people_read\nspark:messages_write\r\nmeeting:schedules_read")).toEqual([
      "spark:people_read",
      "spark:messages_write",
      "meeting:schedules_read"
    ]);
  });
});

describe("scopesToParam", () => {
  it("joins scopes with a single space and contains no quotes or commas", () => {
    const param = scopesToParam(normalizeScopes('"spark:people_read","spark:messages_write"'));
    expect(param).toBe("spark:people_read spark:messages_write");
    expect(param).not.toContain('"');
    expect(param).not.toContain("'");
    expect(param).not.toContain(",");
  });
});
