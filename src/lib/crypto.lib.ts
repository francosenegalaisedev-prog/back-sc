import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "../config/env";

const ENCRYPTION_KEY = Buffer.from(env.TWO_FA_ENCRYPTION_KEY, "hex"); // 32 bytes (64 chars hex)

// TWO_FA_ENCRYPTION_KEY => Secret key used for encrypting and decrypting the 2FA secret. It should be a 32-byte (256-bit) key,
// represented as a 64-character hexadecimal string. This key is crucial for ensuring the security of the encrypted data, and it must be kept confidential.

// 1. Chiffrer le secret avant stockage en BDD
export function encryptSecret(plainSecret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainSecret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

// Decrypt secret
export function decryptSecret(cipherText: string): string {
  const parts = cipherText.split(":");
  if (parts.length !== 3) {
    throw new Error("Format de secret 2FA chiffré invalide");
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// Generate recovery codes for 2FA
export async function generateRecoveryCodes(count = 8) {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    plainCodes.push(formatted);
    hashedCodes.push(await bcrypt.hash(formatted, 10));
  }

  return { plainCodes, hashedCodes };
}
