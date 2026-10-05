import { createHash } from "node:crypto";
import { knowledgePacketSchema, type KnowledgePacket } from "@deliberation-ai/contracts";
import { KnowledgeIntegrityError, knowledgeExcerptLocator } from "./knowledge";

export function knowledgePacketFingerprint(packet: Omit<KnowledgePacket, "fingerprint">) {
  const { fingerprint: _ignored, ...canonical } = knowledgePacketSchema.parse({ ...packet, fingerprint: "0".repeat(64) });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
export function validateKnowledgePacket(value: unknown): KnowledgePacket {
  const packet = knowledgePacketSchema.parse(value), { fingerprint, ...body } = packet;
  const ids = packet.scopes.map((scope) => scope.collectionId);
  if (knowledgePacketFingerprint(body) !== fingerprint || new Set(ids).size !== ids.length
    || packet.scopes.some((scope) => scope.ownerId !== packet.ownerId || scope.accountId !== "local")
    || packet.excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0) > 9_000
    || new Set(packet.inventory.map((item) => item.sourceId)).size !== packet.inventory.length
    || new Set(packet.excerpts.map((item) => item.excerptId)).size !== packet.excerpts.length
    || new Set(packet.excerpts.map((item) => item.source.sourceId)).size !== packet.excerpts.length
    || new Set(packet.omissions.map((item) => item.sourceId)).size !== packet.omissions.length
    || packet.omissions.some((item) => !ids.includes(item.collectionId) || packet.excerpts.some((excerpt) => excerpt.source.sourceId === item.sourceId)
      || !packet.inventory.some((entry) => entry.sourceId === item.sourceId && entry.versionId === item.versionId))
    || packet.withoutEvidence !== (packet.excerpts.length === 0)
    || packet.coverage.length !== ids.length || new Set(packet.coverage.map((item) => item.collectionId)).size !== ids.length
    || packet.coverage.some((item) => !ids.includes(item.collectionId) || item.selected + item.omitted !== item.matches
      || item.matches + item.unavailable > item.inspected
      || item.selected !== packet.excerpts.filter((excerpt) => excerpt.source.scope.collectionId === item.collectionId).length
      || item.omitted !== packet.omissions.filter((omitted) => omitted.collectionId === item.collectionId).length)
    || packet.coverage.reduce((sum, item) => sum + item.inspected, 0) !== packet.inventory.length) throw new KnowledgeIntegrityError();
  for (const excerpt of packet.excerpts) {
    const scope = packet.scopes.find((item) => item.collectionId === excerpt.source.scope.collectionId);
    if (!scope || JSON.stringify(scope) !== JSON.stringify(excerpt.source.scope)
      || !packet.inventory.some((item) => item.sourceId === excerpt.source.sourceId && item.versionId === excerpt.source.versionId)
      || createHash("sha256").update(excerpt.text).digest("hex") !== excerpt.textHash
      || knowledgeExcerptLocator(excerpt.source.versionId, excerpt.source.textHash, excerpt.start, excerpt.end, excerpt.page) !== excerpt.excerptId) throw new KnowledgeIntegrityError();
  }
  return packet;
}
