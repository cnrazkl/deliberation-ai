import { mkdir, writeFile } from "node:fs/promises";
import { provisionLocalRoot, registerLocalUser, loginLocalUser, closeDatabase } from "@deliberation-ai/persistence";

export default async function setup() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!/^\/da_it_[a-f0-9]{16}$/u.test(url.pathname) || url.hostname !== "127.0.0.1" || !process.env.DELIBERATION_TEST_PASSWORD)
    throw new Error("Browser verification requires its isolated database and generated test password.");
  try {
    await provisionLocalRoot(process.env.DELIBERATION_TEST_PASSWORD);
    await mkdir(".local/e2e", { recursive: true });
    await registerLocalUser({ username: "e2e-member", password: process.env.DELIBERATION_TEST_PASSWORD });
    for (const [username, filename] of [["root", "root-session"], ["e2e-member", "session"]]) {
      const { token, session } = await loginLocalUser({ username, password: process.env.DELIBERATION_TEST_PASSWORD });
      await writeFile(`.local/e2e/${filename}.json`, JSON.stringify({ cookies: [{ name: "deliberation-session", value: token,
        domain: "127.0.0.1", path: "/", expires: Date.parse(session.expiresAt) / 1000, httpOnly: true, secure: false, sameSite: "Strict" }], origins: [] }), { mode: 0o600 });
      if (filename === "session") await writeFile(".local/e2e/owner.json", JSON.stringify({ ownerId: session.scope.ownerId }));
    }
  } finally { await closeDatabase(); }
}
