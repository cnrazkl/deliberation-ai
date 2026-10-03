# DA-104 acceptance — 3 October 2026

Scope: reviewed preflight draft payload scrubbing, content-free tombstone/confirmation replay, original-intent suppression and restored metadata verification. [Contract](PREFLIGHT_DRAFT_DELETION.md), [ADR](adr/0031-reviewed-preflight-draft-content-deletion.md).

- 273 unit tests pass, including explicit acknowledgement and receipt private-field rejection.
- 177 isolated PostgreSQL tests pass. Seven new cases cover read-only preview, atomic scrubbing/receipt replay, ordinary enqueue bypass, exact microsecond drift, foreign ownership, column/FK/trigger drift, start/deletion and create/deletion races, started/legacy-cancelled stubs, oversize bounds and malformed restored receipts.
- The 28-case browser sweep passed 27 cases; the old missing-context test still expected the removed immediate-delete button. It was updated to the review/acknowledgement flow. Both the repaired test and new deletion scenario pass in the focused repeat. This is evidence across those runs, not a single clean full-suite execution.
- Browser acceptance verifies cancellation preserves local clarification, main draft preservation, same-origin/matching-ID/acknowledgement/body-size rejection, legacy DELETE refusal, stale-review refresh and a deliberately lost committed response with receipt recovery. No generation is dispatched by deletion.
- Workspace type checks, zero-warning lint, separate-output production build and full dependency audit pass.
- A synthetic-only source database was dumped to a real custom archive and restored to a separate disposable database. Receipt metadata matched semantically, both ciphertexts stayed null, exhaustive encryption/metadata validation passed and the original intent remained blocked. Both disposable databases were removed; the primary database was not replaced.

No schema migration, paid/cloud call, TypeSafe/JEV activation, real owner-history deletion or cache cleanup was performed. Browser and destructive checks touched exact generated fixtures only; the failed legacy-test fixture was verified by its unique generated question and removed. Old backups/exports, independent contexts, linked council work and physical storage remain outside scope. Publication includes the existing full-history secret scan and Security CI; those are not a complete security or erasure certificate.
