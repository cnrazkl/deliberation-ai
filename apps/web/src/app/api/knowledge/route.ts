import { withLocalSession } from "../../../lib/local-auth";
import { z } from "zod";
import { knowledgeFileMediaSchema, knowledgeScopeSchema, knowledgeSelectionSchema } from "@deliberation-ai/contracts";
import { createKnowledgeCollection, createKnowledgeConversation, listKnowledgeCollections, changeKnowledgeGrant, exportConversationKnowledge,
  setConversationKnowledge, importKnowledgeFiles, listKnowledgeSources, prepareKnowledgePacket, KnowledgePacketStaleError,
  KnowledgeSelectionConflictError, KnowledgeQueryError, KnowledgeEvidenceNotFoundError } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = z.string().uuid();
const commands = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("state"), conversationId: uuid.nullable() }).strict(),
  z.object({ operation: z.literal("conversation") }).strict(),
  z.object({ operation: z.literal("collection"), title: z.string().trim().min(1).max(200) }).strict(),
  z.object({ operation: z.literal("grant"), collectionId: uuid, revision: z.number().int().min(1), status: z.enum(["active", "revoked"]) }).strict(),
  z.object({ operation: z.literal("bind"), conversationId: uuid, revision: uuid.nullable(), selection: knowledgeSelectionSchema.nullable() }).strict(),
  z.object({ operation: z.literal("sources"), scope: knowledgeScopeSchema, cursor: uuid.nullable() }).strict(),
  z.object({ operation: z.literal("import"), scope: knowledgeScopeSchema, files: z.array(z.object({ sourceId: uuid, expectedVersionId: uuid.nullable(),
    name: z.string().min(1).max(200), mediaType: knowledgeFileMediaSchema, dataBase64: z.string().min(1).max(7 * 1_048_576) }).strict()).min(1).max(6) }).strict(),
  z.object({ operation: z.literal("prepare"), id: uuid, conversationId: uuid, selectionRevision: uuid,
    query: z.string().trim().min(1).max(4_000), allowWithoutEvidence: z.boolean() }).strict(),
]);
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function sessionPOST(request: Request) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    if (!request.body) return response({ error: "İstek gövdesi gerekli." }, 400);
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
      if (bytes > 18 * 1_048_576) { await reader.cancel(); return response({ error: "Dosya paketi sınırı aşıldı." }, 413); } chunks.push(next.value); }
    const parsed = commands.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return response({ error: "Kaynak işlemi geçersiz." }, 422);
    const command = parsed.data;
    switch (command.operation) {
      case "state": return response({ collections: await listKnowledgeCollections(), selection: command.conversationId ? await exportConversationKnowledge(command.conversationId) : null });
      case "conversation": return response(await createKnowledgeConversation());
      case "collection": return response(await createKnowledgeCollection(command.title));
      case "grant": return response(await changeKnowledgeGrant(command.collectionId, command.revision, command.status));
      case "bind": return response({ revision: await setConversationKnowledge(command.conversationId, command.revision, command.selection) });
      case "sources": return response(await listKnowledgeSources(command.scope, command.cursor));
      case "import": {
        const files = command.files.map(({ dataBase64, ...file }) => {
          const bytes = Buffer.from(dataBase64, "base64"); if (bytes.toString("base64") !== dataBase64) throw new Error("Invalid bytes"); return { ...file, bytes };
        }); return response(await importKnowledgeFiles(command.scope, files));
      }
      case "prepare": return response(await prepareKnowledgePacket(command));
    }
  } catch (error) {
    if (error instanceof KnowledgeQueryError) return response({ error: error.feedback, code: "knowledge_query_invalid" }, 422);
    if (error instanceof KnowledgeEvidenceNotFoundError) return response({
      error: "Bütün arama sözcüklerini birlikte içeren bir alıntı bulunamadı. Kaynakta geçen daha az sözcükle tekrar arayın. Bu sonuç, kaynakta yanıt olmadığı anlamına gelmez.",
      code: "knowledge_evidence_not_found",
    }, 422);
    return response({ error: error instanceof KnowledgePacketStaleError || error instanceof KnowledgeSelectionConflictError
      ? "Seçim veya kaynaklar değişti; yenileyip tekrar inceleyin." : "Kaynak işlemi tamamlanamadı; izinleri, dosya türünü ve sınırları kontrol edin." },
    error instanceof KnowledgePacketStaleError || error instanceof KnowledgeSelectionConflictError ? 409 : 422);
  }
}

export const POST = withLocalSession(sessionPOST);
