# DA-120: scoped knowledge foundation

Implemented backend foundation, 5 October 2026. The owner authorized this next
technical increment after accepting the DA-119 trial agreement. Independent human
gold/model-quality acceptance remain open. No ingestion, council retrieval, external
adapter or library UI is enabled.

## Owned collections and grants

`createKnowledgeCollection` creates an owned `local` account collection and a revoked
grant. Creation never authorizes retrieval or selects the collection. Bounded titles
use strict JSON and authenticated `knowledge-collection:<id>:body` encryption.
`changeKnowledgeGrant` requires the current integer revision; every explicit active/
revoked change increments it. Authorization matches owner, account, collection, grant
ID, exact revision and active state. Regrant cannot revive old selections. Persistence
derives `LOCAL_OWNER_ID`; external accounts are unsupported and fail closed.

## Conversation selections

`setConversationKnowledge` requires an owned conversation, current selection UUID
(or null when unbound), a topic of at most 4,000 characters and one to three distinct
active scopes. Selection encryption authenticates both conversation ID and selection
UUID, so earlier same-conversation ciphertext cannot be replayed as the new revision.
The encrypted snapshot and relational many-to-many rows must agree on
exact owner/collection/grant/revision identity. Owner advisory locking serializes grant,
selection and conversation deletion mutations. Replacements get a fresh UUID;
concurrent stale replacements fail.

Passing null with the current UUID explicitly clears current topic/selection settings
and join rows. Repeated clearing of the already unbound null state is harmless.
Clearing does not erase collections, grant state, source material or existing run
copies. No selection-change audit/history is introduced. New conversations start
unbound; existing continuation/fork paths neither copy nor send these selections.

`conversationKnowledgeAuthorization` binds reads to the exact selection UUID and
current grants. Clearing/replacing, revoke or regrant invalidates the old gateway.
Revoked selections stay inspectable with `available: false` until explicitly changed;
inspection does not authorize retrieval.

## Normalized read boundary

The application `KnowledgeSourcePort` exposes `inspectNotebook`, `searchSources` and
`readExcerpt`. `ScopedKnowledgeSource` denies empty/unselected scopes before adapter
access, rechecks current authorization before and after calls, and rejects foreign
scopes, duplicate/oversized results, extra fields, wrong source/version/excerpt IDs,
invalid span lengths and mismatched excerpt SHA-256 hashes. Sources carry original/
text hashes and parser version; excerpts carry offsets and optional page provenance.
Search allows 30 sources and a 4,000-character query; excerpts allow 1,500 characters.
Actual source byte/span reconstruction is DA-121; these checks alone cannot prove
semantic citation correctness.

The deterministic `FakeKnowledgeSource` is an offline adapter. Its call inventory
records only operation/scope, never query/text. No network/model call, provider SDK,
discovery fallback, write capability or durable index is introduced. Packet-wide six-
excerpt/9,000-character limits and enqueue/dispatch fences are DA-122; council runtime
does not use this gateway yet.

## Retention, export and recovery

Migration 0050 adds four tables with NO ACTION foreign keys. Titles/topics are
encrypted; identities, grant status/revision and relationships are plaintext metadata.
No table references run-owned records, so run retention preserves independent library
and selection state. Collection/source erasure is outside DA-120.

Conversation JSON/Markdown exports include current topic, pinned scopes, selection
UUID and grant availability in the same snapshot, without reading collection titles
or source bodies. `exportKnowledgeCollection` separately exports only the owned title/
current grant. Exports are plaintext owner artifacts, not new grants.

Empty-conversation deletion checks exact registered columns, NO ACTION dependencies
and custom triggers. A row in either selection table blocks deletion as
`retained_references`; foreign ownership also blocks it. Deletion locks both tables
and never deletes them. Clear current settings and obtain a fresh preview before
deleting empty conversation metadata. Collections/grants survive.

Backup auditing inventories both ciphertext fields, validates schemas and cross-checks
selection ownership/relationships/current grant revisions. Partial knowledge schemas
are rejected; historical archives can omit the entire four-table era.
`verify-knowledge-scope-restore.ts` migrates/dumps/restores generated data in two
disposable databases, verifies identical ciphertext/metadata and preserved revoke
denial, then removes only its generated databases/archive. The owner's DB was not
migrated. [Verification](DA120_ACCEPTANCE.md), [ADR-0035](adr/0035-scoped-knowledge-foundation.md).
