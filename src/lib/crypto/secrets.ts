import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Symmetric secret vault for supplier credentials — AES-256-GCM with a key from
 * SETTINGS_ENCRYPTION_KEY (32 bytes, base64). Ciphertext layout is base64 of
 * `iv(12) | authTag(16) | ciphertext`. GCM is authenticated, so a tampered blob
 * fails to decrypt rather than yielding garbage.
 *
 * SERVER ONLY. It imports node:crypto and reads a server env var, so it can never
 * be bundled to the browser. Callers must never return decrypted values to a
 * client — the vault exists precisely so plaintext secrets never leave the server.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) throw new Error("SETTINGS_ENCRYPTION_KEY is not set — supplier credentials cannot be encrypted.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be a 32-byte base64 key (256-bit).");
  }
  return key;
}

/** True when a valid 32-byte key is configured (so callers can degrade gracefully). */
export function isVaultConfigured(): boolean {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) return false;
  try {
    return Buffer.from(raw, "base64").length === 32;
  } catch {
    return false;
  }
}

/** Encrypt a UTF-8 string → base64(iv | tag | ciphertext). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypt a base64(iv | tag | ciphertext) blob back to the original string. */
export function decryptSecret(blob: string): string {
  const raw = Buffer.from(blob, "base64");
  if (raw.length < IV_LEN + TAG_LEN) throw new Error("Malformed encrypted secret.");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Encrypt a JSON-serializable value (e.g. a credentials object). */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

/** Decrypt back to a typed value. Returns null on any failure (missing key, tamper, bad JSON). */
export function decryptJson<T>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  try {
    return JSON.parse(decryptSecret(blob)) as T;
  } catch {
    return null;
  }
}
