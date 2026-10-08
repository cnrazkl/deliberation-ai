import { withLocalSession } from "../../../../lib/local-auth";
import { continuationSourceSchema, councilMembersSchema, MAX_RUN_ATTACHMENTS, riskProfileSchema } from "@deliberation-ai/contracts";
import { ContinuationUnavailableError, PreflightMismatchError, loadRunContinuation, loadFrozenMemoryEntries, loadFrozenToolContexts, loadRelevantToolContexts } from "@deliberation-ai/persistence";
import { z } from "zod";
import { knowledgePacketReferenceSchema } from "@deliberation-ai/contracts";
import { loadKnowledgePacket, assertKnowledgePacketAttachmentRouting } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../../lib/request-security";
import { estimateTokenPreview } from "../../../../lib/token-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewSchema = z.object({
  knowledgePacket: knowledgePacketReferenceSchema.optional(),
  continuationSource: continuationSourceSchema.optional(),
  question: z.string().trim().max(4_000),
  riskProfile: riskProfileSchema.default("standard"),
  reviewRounds: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(1),
  members: councilMembersSchema,
  providerMode: z.enum(["fake", "remote"]),
  memoryEntryIds: z.array(z.string().uuid()).max(5),
  toolResultIds: z.array(z.string().uuid()).max(3),
  retrieveToolContext: z.boolean(),
  images: z.array(z.object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().min(1).max(30_000),
    height: z.number().int().min(1).max(30_000),
  })).max(MAX_RUN_ATTACHMENTS),
  documents: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    content: z.string().min(1).max(64_000),
  })).max(MAX_RUN_ATTACHMENTS),
}).superRefine((value, context) => {
  if (value.members.some((member) => value.providerMode === "fake" ? member.provider !== "fake" : member.provider === "fake")) {
    context.addIssue({ code: "custom", message: "Üye ve sağlayıcı modu eşleşmiyor.", path: ["members"] });
  }
  if (new Set(value.memoryEntryIds).size !== value.memoryEntryIds.length || new Set(value.toolResultIds).size !== value.toolResultIds.length) {
    context.addIssue({ code: "custom", message: "Tekrarlanan bağlam kimliği.", path: ["memoryEntryIds"] });
  }
});

async function sessionPOST(request: Request) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Geçerli JSON gerekli." }, { status: 400 }); }
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Önizleme bilgileri geçersiz." }, { status: 422 });
  try {
    const value = parsed.data;
    const knowledgePacket = value.knowledgePacket ? await loadKnowledgePacket(value.knowledgePacket) : null;
    const continuationContext = value.continuationSource ? await loadRunContinuation(value.continuationSource.runId, value.continuationSource.expectedSha256, value.continuationSource.compaction) : null;
    const memoryContext = await loadFrozenMemoryEntries(value.memoryEntryIds);
    const selected = await loadFrozenToolContexts(value.toolResultIds);
    const retrieved = value.retrieveToolContext ? await loadRelevantToolContexts(value.question, 3) : [];
    const toolContext = [...new Map([...selected, ...retrieved].map((item) => [item.id, item])).values()].slice(0, 3);
    if (knowledgePacket) await assertKnowledgePacketAttachmentRouting(knowledgePacket, [...value.documents, ...value.images].map((item) => item.sha256));
    const result = estimateTokenPreview({ question: value.question, continuationContext, members: value.members, images: value.images, documents: value.documents, memoryContext, toolContext, riskProfile: value.riskProfile, reviewRounds: value.reviewRounds, knowledgePacket });
    if (knowledgePacket && result.members.some((item) => item.totalTokens > 24_000)) return Response.json({ error: "Kaynak paketli girdi 24.000 tahmini token sınırını aşıyor; bağlamı daraltın." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PreflightMismatchError || error instanceof ContinuationUnavailableError) return Response.json({ error: error.message }, { status: error instanceof PreflightMismatchError ? 409 : 422 });
    return Response.json({ error: "Bağlam okunamadı; token önizlemesi hesaplanamadı." }, { status: 422 });
  }
}

export const POST = withLocalSession(sessionPOST);
