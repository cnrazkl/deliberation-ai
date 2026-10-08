import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { withStudyOwner } from "./study-owner";
import { getOwnerId } from "./owner";
import { closeDatabase, getPool } from "./database";
import { saveProviderConnection, loadProviderConnectionSecret } from "./provider-connections";
import { hashLocalPassword } from "./local-password";

afterAll(closeDatabase);
test("study dispatch rejects root/missing identities and cannot read a foreign connection", async () => {
  await expect(withStudyOwner("local-owner", async () => true)).rejects.toThrow();
  await expect(withStudyOwner(`user:${randomUUID()}`, async () => true)).rejects.toThrow();
  const firstId = randomUUID(), secondId = randomUUID();
  const first = { id: firstId, ownerId: `user:${firstId}` }, second = { id: secondId, ownerId: `user:${secondId}` };
  const passwordHash = await hashLocalPassword(randomBytes(24).toString("base64url"));
  try {
  for (const user of [first, second]) await getPool().query("INSERT INTO local_users (id,owner_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,'Study fixture','user',$4)", [user.id,user.ownerId,`study_${randomBytes(8).toString("hex")}`,passwordHash]);
  const connection = await withStudyOwner(first.ownerId, async () => {
    expect(getOwnerId()).toBe(first.ownerId);
    return saveProviderConnection({ provider: "openai", label: "Study fixture", apiKey: "fixture-key", defaultModel: "fixture-model", endpointPreset: "custom", reasoningProtocol: "none", structuredOutputMode: "json-schema" });
  });
  expect(await withStudyOwner(second.ownerId, () => loadProviderConnectionSecret(connection.id))).toBeUndefined();
  expect((await withStudyOwner(first.ownerId, () => loadProviderConnectionSecret(connection.id)))?.id).toBe(connection.id);
  } finally {
    await getPool().query("DELETE FROM provider_connections WHERE owner_id=ANY($1::text[])", [[first.ownerId,second.ownerId]]);
    await getPool().query("DELETE FROM local_users WHERE id=ANY($1::uuid[])", [[first.id,second.id]]);
  }
});
