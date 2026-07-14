import { describe, expect, it } from "vitest";
import { containsWholeWordPhrase } from "@/lib/signal-agent/keywordMatch";

describe("containsWholeWordPhrase — word-boundary keyword matching (regression)", () => {
  it("never matches a short keyword as a substring inside an unrelated word", () => {
    // "rum" (Real User Monitoring keyword) must never match inside
    // "instrumenting" / "instrumented" — a real regression that
    // silently inflated cloud_native_observability's score.
    expect(containsWholeWordPhrase("we've started instrumenting with opentelemetry", "rum")).toBe(false);
    expect(containsWholeWordPhrase("our opentelemetry instrumented services", "rum")).toBe(false);
  });

  it("still matches a genuine whole-word occurrence", () => {
    expect(containsWholeWordPhrase("we need real user monitoring, or rum, for our storefront", "rum")).toBe(true);
  });

  it("still matches a keyword phrase that is itself a plural/inflected form listed verbatim", () => {
    expect(containsWholeWordPhrase("we have too many consoles", "too many consoles")).toBe(true);
  });

  it("matches multi-word phrases with correct boundaries", () => {
    expect(containsWholeWordPhrase("we need single pane visibility", "single pane")).toBe(true);
    expect(containsWholeWordPhrase("a single-panel display", "single pane")).toBe(false);
  });

  it("never throws on regex special characters in the needle", () => {
    expect(() => containsWholeWordPhrase("cost (per unit)", "cost (per unit)")).not.toThrow();
  });
});
