import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function currentKey(): Buffer {
  const encoded = process.env.DATA_ENCRYPTION_KEY;
  if (!encoded) throw new Error("DATA_ENCRYPTION_KEY is required.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to 32 bytes.");
  return key;
}

function keyVersion(): number {
  const version = Number(process.env.KEY_VERSION ?? "1");
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("KEY_VERSION must be positive.");
  return version;
}

export function encryptText(plaintext: string, context: string, key = currentKey()): string {
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", keyVersion(), iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptText(envelope: string, context: string, key = currentKey()): string {
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes.");
  const parts = envelope.split(":");
  const [format, _version, ivValue, tagValue, ciphertextValue] = parts;
  // AES-GCM legitimately emits an empty ciphertext for an empty plaintext
  // (for example a keyless local provider); the authentication tag still binds it.
  if (format !== "v1" || !ivValue || !tagValue || ciphertextValue === undefined || parts.length !== 5) {
    throw new Error("Encrypted value has an unsupported format.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivValue, "base64"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptJson(value: unknown, context: string): string {
  return encryptText(JSON.stringify(value), context);
}

export function decryptJson<T>(envelope: string, context: string): T {
  return JSON.parse(decryptText(envelope, context)) as T;
}
