import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, test } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { defaultFakeCouncilMembers, saveCouncilTemplateSchema } from "@deliberation-ai/contracts";
import { closeDatabase, getDatabase } from "./database";
import { councilTemplates } from "./schema";
import { encryptJson } from "./crypto";
import { CouncilTemplateConflictError, deleteCouncilTemplate, saveCouncilTemplate } from "./council-templates";

const names: string[] = [];
function input() {
  const name = `generated-${randomUUID()}`;
  names.push(name);
  return saveCouncilTemplateSchema.parse({ name, description: "Generated retry fixture", members: defaultFakeCouncilMembers });
}
afterEach(async () => {
  if (names.length) await getDatabase().delete(councilTemplates).where(inArray(councilTemplates.name, names));
  names.length = 0;
});
afterAll(closeDatabase);

test("an identical creation retry returns the same row without changing encrypted content or timestamps", async () => {
  const request = input();
  const saved = await saveCouncilTemplate(request);
  const before = await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, saved.id));
  expect(await saveCouncilTemplate(request)).toEqual(saved);
  expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, saved.id))).toEqual(before);
});

test("same-name creation cannot silently change descriptions or member settings", async () => {
  const request = input();
  const saved = await saveCouncilTemplate(request);
  await expect(saveCouncilTemplate({ ...request, description: "Different draft" })).rejects.toBeInstanceOf(CouncilTemplateConflictError);
  await expect(saveCouncilTemplate({ ...request, members: request.members.map((member, index) => index ? member : { ...member, model: "changed-model" }) })).rejects.toBeInstanceOf(CouncilTemplateConflictError);
  expect(await saveCouncilTemplate(request)).toEqual(saved);
});

test("missing and deleted explicit update identities never create replacements", async () => {
  const request = input();
  await expect(saveCouncilTemplate({ ...request, id: randomUUID() })).rejects.toBeInstanceOf(CouncilTemplateConflictError);
  const saved = await saveCouncilTemplate(request);
  expect(await deleteCouncilTemplate(saved.id)).toBe(true);
  await expect(saveCouncilTemplate({ ...request, id: saved.id })).rejects.toBeInstanceOf(CouncilTemplateConflictError);
  expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.name, request.name))).toHaveLength(0);
});

test("explicit owned updates still work and stale creation payloads cannot undo them", async () => {
  const request = input();
  const saved = await saveCouncilTemplate(request);
  const updated = await saveCouncilTemplate({ ...request, id: saved.id, description: "Explicit update" });
  expect(updated.id).toBe(saved.id);
  expect(updated.description).toBe("Explicit update");
  await expect(saveCouncilTemplate(request)).rejects.toBeInstanceOf(CouncilTemplateConflictError);
});

test("foreign identities cannot be updated or deleted and owner names remain independent", async () => {
  const request = input();
  const id = randomUUID();
  await getDatabase().insert(councilTemplates).values({ id, ownerId: "generated-foreign-owner", name: request.name,
    description: request.description, memberCount: request.members.length,
    membersCiphertext: encryptJson(request.members, `council-template:${id}:members`) });
  const before = await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, id));
  await expect(saveCouncilTemplate({ ...request, id })).rejects.toBeInstanceOf(CouncilTemplateConflictError);
  expect(await deleteCouncilTemplate(id)).toBe(false);
  expect((await saveCouncilTemplate(request)).id).not.toBe(id);
  expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, id))).toEqual(before);
});

test("concurrent identical creation retries both return one saved identity", async () => {
  const request = input();
  const results = await Promise.all([saveCouncilTemplate(request), saveCouncilTemplate(request)]);
  expect(results[0]).toEqual(results[1]);
  expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.name, request.name))).toHaveLength(1);
});

test("concurrent conflicting creations preserve exactly one draft", async () => {
  const request = input();
  const results = await Promise.allSettled([saveCouncilTemplate(request), saveCouncilTemplate({ ...request, description: "Other draft" })]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(CouncilTemplateConflictError);
  expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.name, request.name))).toHaveLength(1);
});

test("overlapping explicit update and deletion cannot resurrect a removed template", async () => {
  const request = input();
  const saved = await saveCouncilTemplate(request);
  const results = await Promise.allSettled([deleteCouncilTemplate(saved.id), saveCouncilTemplate({ ...request, id: saved.id, description: "Updated draft" })]);
  expect(results[0]).toEqual({ status: "fulfilled", value: true });
  if (results[1]?.status === "rejected") expect(results[1].reason).toBeInstanceOf(CouncilTemplateConflictError);
  expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.name, request.name))).toHaveLength(0);
});
