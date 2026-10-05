import { createHash } from "node:crypto";
import { knowledgeExcerptSchema, knowledgeScopeSchema, knowledgeSourceSchema, knowledgeObjectIdSchema,
  type KnowledgeExcerpt, type KnowledgeScope, type KnowledgeSource } from "@deliberation-ai/contracts";

// The adapter receives one explicitly authorized scope per call. Discovery and
// publication are intentionally absent from this read-only capability.
export interface KnowledgeSourcePort {
  inspectNotebook(scope: KnowledgeScope): Promise<KnowledgeScope>;
  searchSources(scope: KnowledgeScope, query: string): Promise<KnowledgeSource[]>;
  readExcerpt(scope: KnowledgeScope, sourceId: string, versionId: string, excerptId: string): Promise<KnowledgeExcerpt>;
}
export class KnowledgeAccessError extends Error {
  constructor() { super("Knowledge access is unavailable."); }
}
export function sameKnowledgeScope(left: KnowledgeScope, right: KnowledgeScope): boolean {
  return left.ownerId === right.ownerId && left.accountId === right.accountId && left.collectionId === right.collectionId
    && left.grantId === right.grantId && left.grantRevision === right.grantRevision;
}
export interface KnowledgeAuthorization {
  // Must read current grants, not a cached permission snapshot.
  authorize(scope: KnowledgeScope): Promise<boolean>;
}
export class ScopedKnowledgeSource implements KnowledgeSourcePort {
  constructor(private readonly adapter: KnowledgeSourcePort, private readonly authorization: KnowledgeAuthorization,
    private readonly selected: readonly KnowledgeScope[]) {
    if (selected.length > 3 || new Set(selected.map((scope) => scope.collectionId)).size !== selected.length) throw new KnowledgeAccessError();
    this.selected = selected.map((scope) => knowledgeScopeSchema.parse(scope));
  }
  private async check(scope: KnowledgeScope) {
    if (!knowledgeScopeSchema.safeParse(scope).success || !this.selected.some((selected) => sameKnowledgeScope(selected, scope))
      || !await this.authorization.authorize(scope)) throw new KnowledgeAccessError();
  }
  private pinned(scope: KnowledgeScope) {
    const parsed = knowledgeScopeSchema.safeParse(scope);
    if (!parsed.success) throw new KnowledgeAccessError();
    return Object.freeze(parsed.data);
  }
  async inspectNotebook(scope: KnowledgeScope) {
    scope = this.pinned(scope);
    await this.check(scope);
    const result = knowledgeScopeSchema.safeParse(await this.adapter.inspectNotebook(scope));
    await this.check(scope);
    if (!result.success || !sameKnowledgeScope(result.data, scope)) throw new KnowledgeAccessError();
    return result.data;
  }
  async searchSources(scope: KnowledgeScope, query: string) {
    scope = this.pinned(scope);
    if (!query.trim() || query.length > 4_000) throw new KnowledgeAccessError();
    await this.check(scope);
    const results = await this.adapter.searchSources(scope, query);
    await this.check(scope);
    if (!Array.isArray(results) || results.length > 30) throw new KnowledgeAccessError();
    const parsed: KnowledgeSource[] = [];
    for (const value of results) {
      const source = knowledgeSourceSchema.safeParse(value);
      if (!source.success || !sameKnowledgeScope(source.data.scope, scope)) throw new KnowledgeAccessError();
      parsed.push(source.data);
    }
    if (new Set(parsed.map((source) => source.sourceId)).size !== parsed.length) throw new KnowledgeAccessError();
    return parsed;
  }
  async readExcerpt(scope: KnowledgeScope, sourceId: string, versionId: string, excerptId: string) {
    scope = this.pinned(scope);
    if (![sourceId, versionId, excerptId].every((id) => knowledgeObjectIdSchema.safeParse(id).success)) throw new KnowledgeAccessError();
    await this.check(scope);
    const result = knowledgeExcerptSchema.safeParse(await this.adapter.readExcerpt(scope, sourceId, versionId, excerptId));
    await this.check(scope);
    if (!result.success || !sameKnowledgeScope(result.data.source.scope, scope)
      || result.data.source.sourceId !== sourceId || result.data.source.versionId !== versionId || result.data.excerptId !== excerptId
      || createHash("sha256").update(result.data.text, "utf8").digest("hex") !== result.data.textHash) throw new KnowledgeAccessError();
    return result.data;
  }
}

// Offline adapter only. Call inventory records scope/operation, never queries or
// source bodies. Every returned object is copied so callers cannot alter fixtures.
export class FakeKnowledgeSource implements KnowledgeSourcePort {
  readonly calls: { operation: "inspect" | "search" | "read"; scope: KnowledgeScope }[] = [];
  private readonly excerpts: KnowledgeExcerpt[];
  constructor(excerpts: readonly KnowledgeExcerpt[]) { this.excerpts = structuredClone([...excerpts]); }
  async inspectNotebook(scope: KnowledgeScope) {
    this.calls.push({ operation: "inspect", scope: structuredClone(scope) });
    return structuredClone(scope);
  }
  async searchSources(scope: KnowledgeScope, _query: string) {
    this.calls.push({ operation: "search", scope: structuredClone(scope) });
    return structuredClone([...new Map(this.excerpts.filter((item) => sameKnowledgeScope(item.source.scope, scope))
      .map((item) => [item.source.sourceId, item.source])).values()]);
  }
  async readExcerpt(scope: KnowledgeScope, sourceId: string, versionId: string, excerptId: string) {
    this.calls.push({ operation: "read", scope: structuredClone(scope) });
    const found = this.excerpts.find((item) => sameKnowledgeScope(item.source.scope, scope) && item.source.sourceId === sourceId
      && item.source.versionId === versionId && item.excerptId === excerptId);
    if (!found) throw new KnowledgeAccessError();
    return structuredClone(found);
  }
}
