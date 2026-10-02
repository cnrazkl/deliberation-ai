import { randomUUID } from "node:crypto";
import {
  councilMembersSchema,
  type CouncilMemberConfig,
  type SaveCouncilTemplateRequest,
} from "@deliberation-ai/contracts";
import { and, asc, eq } from "drizzle-orm";
import { decryptJson, encryptJson } from "./crypto";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { councilTemplates } from "./schema";

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
  const deleted = await getDatabase()
    .delete(councilTemplates)
    .where(
      and(
        eq(councilTemplates.ownerId, LOCAL_OWNER_ID),
        eq(councilTemplates.id, templateId),
      ),
    )
    .returning({ id: councilTemplates.id });
  return deleted.length > 0;
}
