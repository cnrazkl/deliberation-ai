# DA-120 verification

5 October 2026, `codex/da120-knowledge-scope`.

[Scope contract](KNOWLEDGE_SCOPE.md) and [ADR-0035](adr/0035-scoped-knowledge-foundation.md)
cover the backend foundation. DA-119 human labels/model-quality acceptance remain
open. No ingestion UI, real adapter, provider retrieval, publication or source erasure
is enabled.

## Verification

- `pnpm test`: 310 tests, 50 files. Six gateway boundary tests and Markdown revoked-scope preservation are included.
- `pnpm test:integration:isolated`: 220 tests, 25 files. Ten knowledge cases cover encryption/AAD including same-conversation ciphertext replay, explicit many-to-many choices, foreign scope denial, revoke/regrant, stale/concurrent writes, selection clearing, reviewed metadata deletion, backup schema-era checks and fixture-only run retention.
- All 42 Playwright cases passed in a generated database (3.7 minutes), including conversation JSON/Markdown exports and reviewed deletion regression coverage.
- Workspace/script typecheck, zero-warning lint and separate-output production build pass.
- Dependency audit reports no known vulnerabilities; all seven lint-dependency compatibility checks pass.
- Actual custom-format `pg_dump`/`pg_restore` of populated generated collections/selections preserves identical ciphertext, topic/scope/revision exports and revoked authorization. Temporary databases/archive were removed; no owner restore was attempted.
- All 713 relative documentation file links resolve; staged/full-history Gitleaks scans find no secrets and `git diff --cached --check` passes. Generated snapshot comparison confirms four added tables and no changes to existing tables.
- CI adds 12 offline application/Markdown checks beside frozen evaluation preparation; PostgreSQL/browser verification remains local and isolated.

Both new ciphertext fields are authenticated and typed in the exhaustive backup audit.
Selection relational rows, account/owner identities and grant revisions are cross-checked;
partial knowledge schema eras fail closed. No provider SDK/network calls occur in the
new tests. Frozen DA-119 evaluation fixtures/approval were not changed.

Migration 0050 is additive, without cascade or source-content columns. It was applied
only to generated isolated test/restore/browser databases. Owner data, primary checkout
and trial approval remain unchanged.
