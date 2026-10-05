# DA-121 verification

5 October 2026, `codex/da121-local-knowledge`.

The [local source contract](LOCAL_KNOWLEDGE_SOURCES.md) and
[ADR-0036](adr/0036-local-knowledge-source-versions.md) cover the backend scope.
Independent human labels/model quality, UI/routing/packets and source deletion remain
open. No optional adapter was admitted, paid call made or owner database migrated.

## Verification

- `pnpm test`: 319 tests in 52 files, including seven selected-file/parser cases and
  two original/page/quote integrity cases.
- `pnpm test:integration:isolated`: 234 tests in 26 files. Fourteen source cases
  verify encryption, identity/page hashes, immutable updates, old quotes, same-byte
  replay, explicit timeout recovery, actual text/table/scan/image fixtures, owner/
  collection/conversation denial, revoke/regrant and revocation during parsing,
  atomic batch refusal, aggregate search/storage limits, SQL pointer integrity and
  backup era/inventory checks.
- Generated-only populated `pg_dump`/`pg_restore` preserves 35 versions, identical
  ciphertext/original bytes, page hashes, old quote/new search and revoked denial.
  Both generated databases and the archive are removed afterward.
- Frozen extraction verification checks four original binary digests and exact
  parser text/page/status snapshots; no fixture label or trial approval changed.
- All 42 browser cases pass in a disposable database (3.7 minutes). The first run
  exposed a CommonJS-loader incompatibility in parser asset resolution; a small
  native asset-path helper fixed it, and all cases passed on repeat.
- Workspace/script typecheck, zero-warning lint, dependency audit and all seven
  lint-dependency compatibility checks pass. Production build verifies a separate
  output tree; no interactive runtime availability is claimed.

## Synthetic resource measurement

The restore helper also measures 30 active sources/960,000 decrypted UTF-8 text bytes,
with 30 cold-pool and 30 warm-pool scans. On Windows x64, Node 24.19.0 and Ryzen 7
5800X, p95 was 185 ms cold/42 ms warm; sampled RSS baseline 387 MiB, peak 486 MiB,
increment 100 MiB. These pass the trial's two-second latency and 256 MiB incremental
sampled-memory thresholds for this synthetic workload. Cold reconnects the pool;
OS/PostgreSQL caches are not purged. RSS sampling is not a hard memory guarantee.
Repeated synthetic text does not measure relevance, semantic recall, model quality,
clean-machine setup, monthly maintenance or monetary savings.

Migration 0051 is additive and exercised only in disposable databases. Existing
attachment/provider behavior is regression-checked separately. Source versions are
independent of run retention and retain failure provenance; library erasure is not
implemented. CI checks offline source integrity and frozen extraction, with no model
network calls.

Production build passes. All 736 relative documentation links resolve. Staged diff
whitespace checks and staged/full-history Gitleaks scans pass. Snapshot comparison
confirms two added tables and all 34 previous table definitions unchanged. Fetch
confirms the branch starts at the unchanged published DA-120 head with no divergence;
the new DA-121 branch is published without modifying main or the primary checkout.
