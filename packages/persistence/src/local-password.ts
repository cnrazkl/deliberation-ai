import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const options = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashLocalPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const key = await derive(password, salt);
  return `scrypt-v1:${salt.toString("hex")}:${key.toString("hex")}`;
}
export async function verifyLocalPassword(password: string, encoded: string | null): Promise<boolean> {
  const parts = encoded?.split(":");
  const valid = !!parts && parts.length === 3 && parts[0] === "scrypt-v1" && /^[a-f0-9]{64}$/u.test(parts[1]!) && /^[a-f0-9]{128}$/u.test(parts[2]!);
  // Unknown users still perform the same password derivation.
  const key = await derive(password, Buffer.from(valid ? parts![1]! : "00".repeat(32), "hex"));
  const expected = Buffer.from(valid ? parts![2]! : "00".repeat(64), "hex");
  return timingSafeEqual(key, expected) && valid;
}
