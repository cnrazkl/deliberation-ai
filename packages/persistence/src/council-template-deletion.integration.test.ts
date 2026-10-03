import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { defaultFakeCouncilMembers, createScheduleSchema } from "@deliberation-ai/contracts";
import { getDatabase, closeDatabase } from "./database";
import { councilTemplates, localSchedules } from "./schema";
import { createLocalSchedule } from "./local-schedules";
import { decryptJson, encryptJson } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { saveCouncilTemplate, listCouncilTemplates, previewCouncilTemplateDeletion, deleteCouncilTemplateContent, decodeCouncilTemplateDeletion,
  CouncilTemplateConflictError, CouncilTemplateDeletionStaleError, CouncilTemplateDeletionBlockedError } from "./council-templates";
import { auditRestoredEncryption } from "../scripts/backup-encryption-audit";
const ids: string[] = [];
afterEach(async () => { if (ids.length) await getDatabase().delete(councilTemplates).where(inArray(councilTemplates.id, ids)); ids.length = 0; });
afterAll(closeDatabase);
async function fixture() {
  const input = { requestId: randomUUID(), name: `Generated deletion ${randomUUID()}`, description: "Generated private description", members: defaultFakeCouncilMembers };
  const template = await saveCouncilTemplate(input); ids.push(template.id); return { input, template };
}
test("review is read-only; deletion scrubs content, retains an authenticated receipt and refuses old creation/update replay", async () => {
  const { input, template } = await fixture();
  const before = await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, template.id));
  const preview = (await previewCouncilTemplateDeletion(template.id))!; expect(preview.eligible).toBe(true);
  expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, template.id))).toEqual(before);
  const receipt = await deleteCouncilTemplateContent(template.id, preview.fingerprint!);
  expect(await deleteCouncilTemplateContent(template.id, preview.fingerprint!)).toEqual(receipt);
  await expect(deleteCouncilTemplateContent(template.id, "a".repeat(64))).rejects.toBeInstanceOf(CouncilTemplateDeletionStaleError);
  const [row] = await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, template.id));
  expect(row!.name).toBe(""); expect(row!.description).toBe("");
  expect(decryptJson(row!.membersCiphertext, `council-template:${template.id}:members`)).toEqual([]);
  expect(decodeCouncilTemplateDeletion(row!)).toEqual(receipt);
  expect((await listCouncilTemplates()).some((item) => item.id === template.id)).toBe(false);
  expect((await previewCouncilTemplateDeletion(template.id))?.alreadyDeleted).toBe(true);
  await expect(saveCouncilTemplate(input)).rejects.toBeInstanceOf(CouncilTemplateConflictError);
  await expect(saveCouncilTemplate({ ...input, requestId: undefined, id: template.id })).rejects.toBeInstanceOf(CouncilTemplateConflictError);
});
test("name reuse requires a fresh identity and cannot revive an old creation request", async () => {
  const { input, template } = await fixture();
  await expect(saveCouncilTemplate({ ...input, requestId: randomUUID() })).rejects.toBeInstanceOf(CouncilTemplateConflictError);
  await deleteCouncilTemplateContent(template.id, (await previewCouncilTemplateDeletion(template.id))!.fingerprint!);
  const newTemplate = await saveCouncilTemplate({ ...input, requestId: randomUUID() }); ids.push(newTemplate.id);
  expect(newTemplate.id).not.toBe(template.id);
  await expect(saveCouncilTemplate(input)).rejects.toBeInstanceOf(CouncilTemplateConflictError);
  expect((await listCouncilTemplates()).filter((item) => item.name === input.name).map((item) => item.id)).toEqual([newTemplate.id]);
});
test("exact timestamp and explicit edit drift invalidate review without erasing content", async () => {
  const { input, template } = await fixture();
  const preview = (await previewCouncilTemplateDeletion(template.id))!;
  await getDatabase().execute(sql`update council_templates set updated_at=updated_at+interval '1 microsecond' where id=${template.id}::uuid`);
  await expect(deleteCouncilTemplateContent(template.id, preview.fingerprint!)).rejects.toBeInstanceOf(CouncilTemplateDeletionStaleError);
  const next = (await previewCouncilTemplateDeletion(template.id))!;
  await saveCouncilTemplate({ ...input, id: template.id, requestId: undefined, description: "Edited description" });
  await expect(deleteCouncilTemplateContent(template.id, next.fingerprint!)).rejects.toBeInstanceOf(CouncilTemplateDeletionStaleError);
  expect((await listCouncilTemplates()).find((item) => item.id === template.id)?.description).toBe("Edited description");
});
test("legacy null creation identities remain deletable and foreign templates remain untouched", async () => {
  const id = randomUUID(); const foreignId = randomUUID(); ids.push(id, foreignId);
  for (const [templateId, ownerId] of [[id, LOCAL_OWNER_ID], [foreignId, "generated-other-owner"]]) await getDatabase().insert(councilTemplates).values({ id: templateId!, ownerId: ownerId!,
    name: `Generated legacy ${templateId}`, membersCiphertext: encryptJson(defaultFakeCouncilMembers, `council-template:${templateId}:members`), memberCount: 2 });
  expect(await previewCouncilTemplateDeletion(foreignId)).toBeUndefined();
  expect(await deleteCouncilTemplateContent(foreignId, "a".repeat(64))).toBeUndefined();
  const receipt = await deleteCouncilTemplateContent(id, (await previewCouncilTemplateDeletion(id))!.fingerprint!);
  expect(receipt?.creationRequestId).toBeNull(); expect(receipt?.creationRequestHash).toBeNull();
  expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, foreignId))).toHaveLength(1);
});
test("column and dependency drift block inspection and deletion", async () => {
  const { template } = await fixture();
  await getDatabase().execute(sql`alter table council_templates add column generated_drift text`);
  try {
    expect((await previewCouncilTemplateDeletion(template.id))?.blockedReasons).toContain("schema_changed");
    await expect(deleteCouncilTemplateContent(template.id, "a".repeat(64))).rejects.toBeInstanceOf(CouncilTemplateDeletionBlockedError);
  } finally { await getDatabase().execute(sql`alter table council_templates drop column generated_drift`); }
  await getDatabase().execute(sql`create table generated_template_dependency(id uuid references council_templates(id))`);
  try { expect((await previewCouncilTemplateDeletion(template.id))?.eligible).toBe(false); }
  finally { await getDatabase().execute(sql`drop table generated_template_dependency`); }
});
test("an altered same-named constraint or request-identity index is refused", async () => {
  const { template } = await fixture();
  await getDatabase().execute(sql`alter table council_templates drop constraint council_templates_member_count_range`);
  await getDatabase().execute(sql`alter table council_templates add constraint council_templates_member_count_range check(member_count between 1 and 7)`);
  try { expect((await previewCouncilTemplateDeletion(template.id))?.eligible).toBe(false); }
  finally { await getDatabase().execute(sql`alter table council_templates drop constraint council_templates_member_count_range`);
    await getDatabase().execute(sql`alter table council_templates add constraint council_templates_member_count_range check(member_count between 2 and 6)`); }
  await getDatabase().execute(sql`drop index council_templates_owner_request_uq`);
  try { expect((await previewCouncilTemplateDeletion(template.id))?.eligible).toBe(false); }
  finally { await getDatabase().execute(sql`create unique index council_templates_owner_request_uq on council_templates(owner_id,creation_request_id)`); }
});
test("backup auditing authenticates retained receipts and refuses corrupt metadata or residual content", async () => {
  const { template } = await fixture();
  await deleteCouncilTemplateContent(template.id, (await previewCouncilTemplateDeletion(template.id))!.fingerprint!);
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    expect((await auditRestoredEncryption(client)).decryptedValues).toBeGreaterThanOrEqual(2);
    await getDatabase().update(councilTemplates).set({ name: "Residual private name" }).where(eq(councilTemplates.id, template.id));
    await expect(auditRestoredEncryption(client)).rejects.toThrow("deletion metadata");
    await getDatabase().update(councilTemplates).set({ name: "" }).where(eq(councilTemplates.id, template.id));
    await getDatabase().update(councilTemplates).set({ deletionReceiptCiphertext: encryptJson({ version: "invalid" }, `council-template:${template.id}:deletion-receipt`) }).where(eq(councilTemplates.id, template.id));
    await expect(previewCouncilTemplateDeletion(template.id)).rejects.toThrow();
    await expect(auditRestoredEncryption(client)).rejects.toThrow("deletion metadata");
  } finally { await client.end(); }
});
test("oversize rows are refused before loading their payload", async () => {
  const { template } = await fixture();
  await getDatabase().update(councilTemplates).set({ description: "x".repeat(1_048_576) }).where(eq(councilTemplates.id, template.id));
  await expect(previewCouncilTemplateDeletion(template.id)).rejects.toBeInstanceOf(CouncilTemplateDeletionBlockedError);
});
test("deleting a template preserves an independently frozen schedule", async () => {
  const { input, template } = await fixture();
  const schedule = await createLocalSchedule(createScheduleSchema.parse({ requestId: randomUUID(), name: "Generated independent schedule", question: "Generated scheduled comparison question",
    providerMode: "fake", members: input.members, reviewRounds: 0, cadence: "daily", nextRunAt: "2400-01-01T00:00:00.000Z" }));
  try {
    const before = await getDatabase().select().from(localSchedules).where(eq(localSchedules.id, schedule.id));
    await deleteCouncilTemplateContent(template.id, (await previewCouncilTemplateDeletion(template.id))!.fingerprint!);
    expect(await getDatabase().select().from(localSchedules).where(eq(localSchedules.id, schedule.id))).toEqual(before);
  } finally { await getDatabase().delete(localSchedules).where(eq(localSchedules.id, schedule.id)); }
});
test("unexpected row triggers block deletion", async () => {
  const { template } = await fixture();
  await getDatabase().execute(sql`create function generated_template_trigger() returns trigger language plpgsql as 'begin return new; end'`);
  await getDatabase().execute(sql`create trigger generated_template_trigger before update on council_templates for each row execute function generated_template_trigger()`);
  try { expect((await previewCouncilTemplateDeletion(template.id))?.blockedReasons).toContain("schema_changed"); }
  finally { await getDatabase().execute(sql`drop trigger generated_template_trigger on council_templates`); await getDatabase().execute(sql`drop function generated_template_trigger()`); }
});
