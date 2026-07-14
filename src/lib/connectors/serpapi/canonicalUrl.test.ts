import { describe, expect, it } from "vitest";
import { canonicalizeUrl, extractDomain } from "@/lib/connectors/serpapi/canonicalUrl";

describe("canonicalizeUrl", () => {
  it("removes tracking parameters", () => {
    const canonical = canonicalizeUrl("https://example.com/article?utm_source=google&utm_medium=cpc&id=42");
    expect(canonical).toBe("https://example.com/article?id=42");
  });

  it("removes the fragment", () => {
    expect(canonicalizeUrl("https://example.com/article#section-2")).toBe("https://example.com/article");
  });

  it("lowercases the hostname", () => {
    expect(canonicalizeUrl("https://Example.COM/Article")).toContain("example.com");
  });

  it("removes a trailing slash when safe", () => {
    expect(canonicalizeUrl("https://example.com/article/")).toBe("https://example.com/article");
  });

  it("two URLs differing only by tracking params canonicalize to the same value (dedup)", () => {
    const a = canonicalizeUrl("https://example.com/story?utm_source=x&gclid=abc");
    const b = canonicalizeUrl("https://example.com/story?fbclid=def");
    expect(a).toBe(b);
  });

  it("never crashes on a malformed URL", () => {
    expect(() => canonicalizeUrl("not a url")).not.toThrow();
  });
});

describe("extractDomain", () => {
  it("strips a leading www.", () => {
    expect(extractDomain("https://www.example.com/page")).toBe("example.com");
  });

  it("never crashes on a malformed URL", () => {
    expect(extractDomain("not a url")).toBe("");
  });
});
