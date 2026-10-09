import { expect, test } from "vitest";
import { createBrowserRequestId } from "./browser-request-id";

test("uses the native secure UUID when the browser exposes it", () => {
  expect(createBrowserRequestId({ randomUUID: () => "native-id", getRandomValues: () => { throw new Error("unexpected fallback"); } })).toBe("native-id");
});

test("LAN fallback obtains 16 secure bytes and encodes UUID v4 and variant bits", () => {
  let calls = 0;
  const source = { getRandomValues: (bytes: Uint8Array) => { expect(bytes.length).toBe(16); calls++; return bytes.fill(255); } };
  expect(createBrowserRequestId(source)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  expect(calls).toBe(1);
});

test("a failing secure entropy source fails instead of returning a weak request id", () => {
  expect(() => createBrowserRequestId({ getRandomValues: () => { throw new Error("secure entropy unavailable"); } })).toThrow("secure entropy unavailable");
});
