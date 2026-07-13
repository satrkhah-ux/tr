import { describe, it, expect, beforeAll } from "vitest";
import { decryptJson, decryptSecret, encryptJson, encryptSecret, isVaultConfigured } from "./secrets";

// A deterministic 32-byte key for the test (getKey() reads env at call time).
beforeAll(() => {
  process.env.SETTINGS_ENCRYPTION_KEY = Buffer.from("0123456789abcdef0123456789abcdef", "utf8").toString("base64");
});

describe("secret vault (AES-256-GCM)", () => {
  it("round-trips a string and never stores plaintext", () => {
    const secret = "tbo-P@ssw0rd-سرّي";
    const blob = encryptSecret(secret);
    expect(blob).not.toContain(secret);
    expect(blob).not.toContain("P@ssw0rd");
    expect(decryptSecret(blob)).toBe(secret);
  });

  it("uses a fresh IV so the same plaintext encrypts differently each time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("round-trips a JSON credentials object", () => {
    const creds = { base_url: "https://api.tbo.example", username: "agent1", password: "s3cret" };
    const blob = encryptJson(creds);
    expect(blob).not.toContain("s3cret");
    expect(decryptJson<typeof creds>(blob)).toEqual(creds);
  });

  it("rejects a tampered blob (authenticated encryption)", () => {
    const blob = encryptSecret("integrity");
    const raw = Buffer.from(blob, "base64");
    raw[raw.length - 1] ^= 0xff; // flip a ciphertext byte
    const tampered = raw.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow();
    expect(decryptJson(tampered)).toBeNull();
  });

  it("reports the vault as configured with a valid 32-byte key", () => {
    expect(isVaultConfigured()).toBe(true);
  });
});
