import { describe, expect, it } from "vitest";
import { validatePublicBaseUrl, validateConstructedUrl, isPrivateOrLocalHostname } from "@/lib/signal-agent/publicUrl";

describe("publicUrl — never treats localhost/private addresses as public (Section 11/12)", () => {
  it("rejects localhost", () => {
    expect(validatePublicBaseUrl("https://localhost:3000").valid).toBe(false);
  });

  it("rejects 127.0.0.1", () => {
    expect(validatePublicBaseUrl("https://127.0.0.1:3000").valid).toBe(false);
  });

  it("rejects private-LAN addresses (10.x, 172.16-31.x, 192.168.x)", () => {
    expect(validatePublicBaseUrl("https://10.0.0.5").valid).toBe(false);
    expect(validatePublicBaseUrl("https://172.20.1.1").valid).toBe(false);
    expect(validatePublicBaseUrl("https://192.168.1.1").valid).toBe(false);
  });

  it("rejects a missing base URL", () => {
    expect(validatePublicBaseUrl(undefined).reason).toBe("no_public_base_url");
    expect(validatePublicBaseUrl("").reason).toBe("no_public_base_url");
  });

  it("rejects a non-HTTPS URL", () => {
    expect(validatePublicBaseUrl("http://app.example.com").valid).toBe(false);
  });

  it("accepts a valid public HTTPS origin", () => {
    expect(validatePublicBaseUrl("https://app.example.com").valid).toBe(true);
  });

  it("validates a fully-constructed URL the same way", () => {
    expect(validateConstructedUrl("https://app.example.com/signal-agent/results/abc?token=xyz").valid).toBe(true);
    expect(validateConstructedUrl("https://localhost/signal-agent/results/abc").valid).toBe(false);
  });

  it("classifies private hostnames directly", () => {
    expect(isPrivateOrLocalHostname("localhost")).toBe(true);
    expect(isPrivateOrLocalHostname("app.example.com")).toBe(false);
  });
});
