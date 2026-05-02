import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const keyHex = process.env.TSD_SECRETS_KEY;
  if (!keyHex) {
    throw new Error("TSD_SECRETS_KEY environment variable is required for credential encryption. Set it to a 64-character hex string (32 bytes).");
  }
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("TSD_SECRETS_KEY must be exactly 64 hex characters (32 bytes).");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(ciphertext, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function isEncrypted(value: string): boolean {
  try {
    const data = Buffer.from(value, "base64");
    return data.length > IV_LENGTH + TAG_LENGTH;
  } catch {
    return false;
  }
}

export function safeDecryptSecret(value: string | null): string | null {
  if (!value) return null;
  if (!process.env.TSD_SECRETS_KEY) return null;
  try {
    return decryptSecret(value);
  } catch {
    return null;
  }
}

export function getSyncInterval(name: "LEAD_SYNC_INTERVAL_MINUTES" | "COMMISSION_SYNC_INTERVAL_MINUTES" | "TELARUS_FULL_SYNC_INTERVAL_MINUTES", defaultMinutes: number): number {
  const raw = process.env[`TSD_${name}`];
  if (!raw) return defaultMinutes;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1) return defaultMinutes;
  return parsed;
}
