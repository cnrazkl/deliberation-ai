import { mkdir, writeFile } from "node:fs/promises";
import { provisionLocalRoot, loginLocalUser, closeDatabase } from "@deliberation-ai/persistence";

export default async function setup() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!/^\/da_it_[a-f0-9]{16}$/u.test(url.pathname) || url.hostname !== "127.0.0.1" || !process.env.DELIBERATION_TEST_PASSWORD)
    throw new Error("Browser verification requires its isolated database and generated test password.");
  try {
    await provisionLocalRoot(process.env.DELIBERATION_TEST_PASSWORD);
    const { token, session } = await loginLocalUser({ username: "root", password: process.env.DELIBERATION_TEST_PASSWORD });
    await mkdir(".local/e2e", { recursive: true });
    await writeFile(".local/e2e/session.json", JSON.stringify({ cookies: [{ name: "deliberation-session", value: token,
      domain: "127.0.0.1", path: "/", expires: Date.parse(session.expiresAt) / 1000, httpOnly: true, secure: false, sameSite: "Strict" }], origins: [] }), { mode: 0o600 });
  } finally { await closeDatabase(); }
}
