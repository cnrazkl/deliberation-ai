import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { decryptText, encryptText } from "./crypto";

describe("encrypted persistence envelope", () => {
  test("round-trips content only with the matching key and context", () => {
    const key = randomBytes(32);
    const encrypted = encryptText("hassas soru", "run:one:question", key);
    expect(encrypted).not.toContain("hassas soru");
    expect(decryptText(encrypted, "run:one:question", key)).toBe("hassas soru");
    expect(() => decryptText(encrypted, "run:two:question", key)).toThrow();
    expect(() => decryptText(encrypted, "run:one:question", randomBytes(32))).toThrow();
  });

  test("accepts an authenticated empty plaintext for a keyless local connection", () => {
    const key = randomBytes(32);
    const encrypted = encryptText("", "provider-connection:local:secret", key);
    expect(encrypted.endsWith(":")).toBe(true);
    expect(decryptText(encrypted, "provider-connection:local:secret", key)).toBe("");
    expect(() => decryptText(encrypted, "provider-connection:other:secret", key)).toThrow();
  });
});
