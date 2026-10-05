import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import type { KnowledgeExcerpt, KnowledgeScope } from "@deliberation-ai/contracts";
import { FakeKnowledgeSource, KnowledgeAccessError, ScopedKnowledgeSource, type KnowledgeSourcePort } from "./knowledge";

const scope = (): KnowledgeScope => ({ ownerId: "owner", accountId: "account", collectionId: randomUUID(), grantId: randomUUID(), grantRevision: 1 });
function fixture(selected = scope()): KnowledgeExcerpt {
  const text = "Synthetic inspectable minority claim.";
  const hash = createHash("sha256").update(text).digest("hex");
  return { source: { scope: selected, sourceId: randomUUID(), versionId: randomUUID(), title: "Fixture", mediaType: "text/plain",
    originalHash: hash, textHash: hash, parserVersion: "fixture-v1" }, excerptId: randomUUID(), text, start: 0, end: text.length, page: null, textHash: hash };
}
test("empty selection, wrong owner, account, notebook, grant and stale revision deny before adapter access", async () => {
  const item = fixture(), selected = item.source.scope, adapter = new FakeKnowledgeSource([item]);
  const gateway = new ScopedKnowledgeSource(adapter, { authorize: async () => true }, [selected]);
  for (const rejected of [scope(), { ...selected, ownerId: "foreign" }, { ...selected, accountId: "foreign" },
    { ...selected, collectionId: randomUUID() }, { ...selected, grantId: randomUUID() }, { ...selected, grantRevision: 2 }]) {
    await expect(gateway.searchSources(rejected, "query")).rejects.toBeInstanceOf(KnowledgeAccessError);
  }
  await expect(new ScopedKnowledgeSource(adapter, { authorize: async () => true }, []).inspectNotebook(selected)).rejects.toBeInstanceOf(KnowledgeAccessError);
  expect(adapter.calls).toEqual([]);
});
test("fake adapter returns pinned source versions and exact hashed spans without recording query or text", async () => {
  const item = fixture(), selected = item.source.scope, adapter = new FakeKnowledgeSource([item, fixture()]);
  const gateway = new ScopedKnowledgeSource(adapter, { authorize: async () => true }, [selected]);
  expect(await gateway.inspectNotebook(selected)).toEqual(selected);
  expect(await gateway.searchSources(selected, "sensitive query")).toEqual([item.source]);
  const read = await gateway.readExcerpt(selected, item.source.sourceId, item.source.versionId, item.excerptId);
  expect(read).toEqual(item); read.text = "changed";
  expect(await gateway.readExcerpt(selected, item.source.sourceId, item.source.versionId, item.excerptId)).toEqual(item);
  expect(JSON.stringify(adapter.calls)).not.toContain("sensitive query");
  expect(JSON.stringify(adapter.calls)).not.toContain(item.text);
});
test("revocation during an in-flight call suppresses its returned content", async () => {
  const item = fixture(); let allowed = true;
  const adapter: KnowledgeSourcePort = { ...new FakeKnowledgeSource([]), inspectNotebook: async (value) => value,
    searchSources: async () => { allowed = false; return [item.source]; }, readExcerpt: async () => item };
  const gateway = new ScopedKnowledgeSource(adapter, { authorize: async () => allowed }, [item.source.scope]);
  await expect(gateway.searchSources(item.source.scope, "query")).rejects.toBeInstanceOf(KnowledgeAccessError);
});
test("malicious adapter cannot return another account or notebook or a duplicate source", async () => {
  const item = fixture(); let result = [fixture().source];
  const adapter: KnowledgeSourcePort = { inspectNotebook: async () => scope(), searchSources: async () => result, readExcerpt: async () => item };
  const gateway = new ScopedKnowledgeSource(adapter, { authorize: async () => true }, [item.source.scope]);
  await expect(gateway.inspectNotebook(item.source.scope)).rejects.toBeInstanceOf(KnowledgeAccessError);
  await expect(gateway.searchSources(item.source.scope, "query")).rejects.toBeInstanceOf(KnowledgeAccessError);
  result = [item.source, item.source];
  await expect(gateway.searchSources(item.source.scope, "query")).rejects.toBeInstanceOf(KnowledgeAccessError);
});
test("wrong version, altered text/hash and broken spans fail closed", async () => {
  const item = fixture(); let result = item;
  const adapter: KnowledgeSourcePort = { inspectNotebook: async (value) => value, searchSources: async () => [item.source], readExcerpt: async () => result };
  const gateway = new ScopedKnowledgeSource(adapter, { authorize: async () => true }, [item.source.scope]);
  const read = () => gateway.readExcerpt(item.source.scope, item.source.sourceId, item.source.versionId, item.excerptId);
  for (const value of [{ ...item, source: { ...item.source, versionId: randomUUID() } },
    { ...item, text: "tampered", end: 8 }, { ...item, end: item.end + 1 }]) {
    result = value; await expect(read()).rejects.toBeInstanceOf(KnowledgeAccessError);
  }
});
test("selection is copied and bounded; invalid queries and excess search results are rejected", async () => {
  const item = fixture(), selected = structuredClone(item.source.scope), adapter = new FakeKnowledgeSource([item]);
  const gateway = new ScopedKnowledgeSource(adapter, { authorize: async () => true }, [selected]);
  selected.accountId = "changed";
  expect(await gateway.searchSources(item.source.scope, "query")).toEqual([item.source]);
  await expect(gateway.searchSources(item.source.scope, " ")).rejects.toBeInstanceOf(KnowledgeAccessError);
  expect(() => new ScopedKnowledgeSource(adapter, { authorize: async () => true }, [scope(), scope(), scope(), scope()])).toThrow(KnowledgeAccessError);
  expect(() => new ScopedKnowledgeSource(adapter, { authorize: async () => true }, [selected, selected])).toThrow(KnowledgeAccessError);
  adapter.searchSources = async () => Array.from({ length: 31 }, () => item.source);
  await expect(gateway.searchSources(item.source.scope, "query")).rejects.toBeInstanceOf(KnowledgeAccessError);
});
