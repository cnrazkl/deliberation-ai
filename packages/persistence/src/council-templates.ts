import { randomUUID } from "node:crypto";
import {
  councilMembersSchema,
  type CouncilMemberConfig,
  type SaveCouncilTemplateRequest,
} from "@deliberation-ai/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
import { decryptJson, encryptJson } from "./crypto";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { councilTemplates } from "./schema";

export class CouncilTemplateConflictError extends Error {}

async function lockTemplateWrites(tx: Parameters<Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]>[0]) {
  await tx.execute(sql`set local lock_timeout='5s'`);
  await tx.execute(sql`set local statement_timeout='10s'`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCAL_OWNER_ID}), hashtext('council-template-writes-v1'))`);
}

export type CouncilTemplate = {
  id: string;
  name: string;
  description: string;
  members: CouncilMemberConfig[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

function mapTemplate(row: typeof councilTemplates.$inferSelect): CouncilTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    members: councilMembersSchema.parse(
      decryptJson<unknown>(row.membersCiphertext, `council-template:${row.id}:members`),
    ),
    memberCount: row.memberCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCouncilTemplates(): Promise<CouncilTemplate[]> {
  const rows = await getDatabase()
    .select()
    .from(councilTemplates)
    .where(eq(councilTemplates.ownerId, LOCAL_OWNER_ID))
    .orderBy(asc(councilTemplates.name));
  return rows.map(mapTemplate);
}

export async function saveCouncilTemplate(
  request: SaveCouncilTemplateRequest,
): Promise<CouncilTemplate> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    await lockTemplateWrites(tx);
    const [existing] = request.id
      ? await tx
          .select()
          .from(councilTemplates)
          .where(
            and(
              eq(councilTemplates.ownerId, LOCAL_OWNER_ID),
              eq(councilTemplates.id, request.id),
            ),
          )
          .limit(1)
      : await tx
          .select()
          .from(councilTemplates)
          .where(
            and(
              eq(councilTemplates.ownerId, LOCAL_OWNER_ID),
              eq(councilTemplates.name, request.name),
            ),
          )
          .limit(1);
    // An explicit update identity must never fall back to creating a new row.
    if (request.id && !existing) throw new CouncilTemplateConflictError();
    if (!request.id && existing) {
      const saved = mapTemplate(existing);
      // A lost create response may be retried, but cannot overwrite another draft.
      if (saved.description !== request.description ||
          JSON.stringify(saved.members) !== JSON.stringify(request.members)) {
        throw new CouncilTemplateConflictError();
      }
      return saved;
    }
    const id = existing?.id ?? randomUUID();
    const values = {
      ownerId: LOCAL_OWNER_ID,
      name: request.name,
      description: request.description,
      membersCiphertext: encryptJson(request.members, `council-template:${id}:members`),
      memberCount: request.members.length,
      updatedAt: new Date(),
    };
    const [saved] = existing
      ? await tx
          .update(councilTemplates)
          .set(values)
          .where(
            and(
              eq(councilTemplates.id, id),
              eq(councilTemplates.ownerId, LOCAL_OWNER_ID),
            ),
          )
          .returning()
      : await tx.insert(councilTemplates).values({ id, ...values }).returning();
    if (!saved) throw new Error("Council template could not be saved.");
    return mapTemplate(saved);
  });
}

export async function deleteCouncilTemplate(templateId: string): Promise<boolean> {
  return getDatabase().transaction(async (tx) => {
    await lockTemplateWrites(tx);
    const deleted = await tx
      .delete(councilTemplates)
      .where(
        and(
          eq(councilTemplates.ownerId, LOCAL_OWNER_ID),
          eq(councilTemplates.id, templateId),
        ),
      )
      .returning({ id: councilTemplates.id });
    return deleted.length > 0;
  });
}
