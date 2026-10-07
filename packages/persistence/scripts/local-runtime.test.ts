import { createServer } from "node:net";
import { expect, test } from "vitest";
import { interactivePortOccupied } from "./local-runtime";
test("detects a bound local port without relying on a responsive HTTP application", async () => {
  const server = createServer((socket) => { socket.on("error", () => undefined); socket.resume(); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error();
  try { expect(await interactivePortOccupied(address.port)).toBe(true); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  expect(await interactivePortOccupied(address.port)).toBe(false);
});
