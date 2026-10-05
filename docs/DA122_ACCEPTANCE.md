# DA-122 verification

5 October 2026, `codex/da122-knowledge-packets`.

The [packet contract](KNOWLEDGE_PACKETS.md) describes the local implementation.
No paid model call, owner database migration or external adapter admission was made.
Independent human labels and DA-126 quality/recovery acceptance remain open.
Local mock calls verify transport, not model behavior.

## Verified boundaries

- 321 unit tests in 53 files pass. New packet cases check canonical hashes, exact
  quote locators, ownership/coverage consistency, unchanged independent inputs,
  untrusted instruction data, review exclusion and the local text budget.
- 240 isolated PostgreSQL tests in 27 files pass. Six packet cases cover fair
  collection coverage, named budget/duplicate exclusions, immutable encrypted retry,
  changed/expired selections, revoke/regrant, explicit empty evidence, denied foreign
  identities, full-file resend refusal, frozen old quotes after edits, request replay,
  per-submission/durable execution denial, historical readability and populated audit.
- Existing 42 browser flows and the new source-bearing local-mock flow are verified
  in disposable databases. The new flow exercises real collection/grant/conversation
  routes, selected PDF/scan/image files, exact passages, owner review, identical
  first-round payloads, absent original bytes/unselected titles, schedule refusal,
  JSON/Markdown run/conversation exports and revocation. It also covers held-context
  preview preservation. Browser suite runs and targeted repeats are recorded locally.
- Generated-only populated custom `pg_dump`/`pg_restore` preserves five source versions,
  originals, hashes, old/manual quotations, an encrypted preparation and frozen run
  copy, conversation identity and revoked denial. Both databases/archive are removed.
- Production build and a separately started production server verify packaged PDF
  worker resolution, exact page-linked extraction and unusable scan/image status.
  No model/worker execution is needed for this production parser check.
- Workspace/script typecheck, zero-warning lint, frozen dependency installation,
  vulnerability audit, all seven lint compatibility cases and four frozen binary
  extraction snapshots pass. The pinned tokenizer was already in the reviewed graph.
- Schema comparison confirms 36 existing tables unchanged except the nullable run
  packet column; one independent preparation table is added. Migration 0052 is only
  exercised in generated databases. All 758 relative documentation links resolve;
  staged whitespace and staged/full-history secret scans pass.

The first source browser attempt needed its selector corrected. A later full run
passed 42 cases but its long-poll observation check failed after development reloads;
the isolated long-poll repeat passed. The held-preview extension initially omitted
required preview DTO fields; correcting the test request exercises the actual route.
These fixture/tooling issues are not evidence of semantic model acceptance.

## Publication and open gates

The increment starts at the unchanged published DA-121 head, with no remote divergence.
Only reviewed source/docs/tests/migration files are staged; no local environment, data,
archive, logs or generated runtime artifacts are published. Main and the primary
checkout are untouched. The prior DA-121 Security job failed before any step because
GitHub could not acquire a hosted runner; this is not a passing remote CI result.
DA-122 remote CI status is checked after push and reported separately.

No independent source-quality labels, injection/entailment benchmark, critical-omission
measurement, universal provider-window fit, monetary savings, library/preparation
erasure, clean-install trial or supported rollout is claimed. DA-123 is next; the
DA-119 human gate and DA-126 empirical acceptance remain required.
