import { describe, expect, it } from "vitest";
import { signRunToken, verifyRunToken } from "@/lib/signal-agent/shareLink";

describe("shareLink — signed, expiring, read-only run tokens", () => {
  it("a freshly-signed token validates for the same runId", () => {
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const token = signRunToken("run-123", expiresAt);
    const verification = verifyRunToken("run-123", token);
    expect(verification.valid).toBe(true);
    expect(verification.reason).toBe("ok");
  });

  it("rejects an expired token", () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    const token = signRunToken("run-123", expiresAt);
    const verification = verifyRunToken("run-123", token);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toBe("expired");
  });

  it("rejects a token issued for a different runId", () => {
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const token = signRunToken("run-123", expiresAt);
    const verification = verifyRunToken("run-999", token);
    expect(verification.valid).toBe(false);
  });

  it("rejects a tampered token", () => {
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const token = signRunToken("run-123", expiresAt);
    const tampered = `${token.slice(0, -2)}zz`;
    const verification = verifyRunToken("run-123", tampered);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toBe("signature_mismatch");
  });

  it("rejects a malformed token", () => {
    expect(verifyRunToken("run-123", "not-a-real-token").valid).toBe(false);
    expect(verifyRunToken("run-123", "").valid).toBe(false);
  });

  it("handles runId values containing dots/colons (ISO-like strings) without corrupting parsing", () => {
    const runId = "2026-07-14T01:23:45.678Z";
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const token = signRunToken(runId, expiresAt);
    expect(verifyRunToken(runId, token).valid).toBe(true);
  });
});
