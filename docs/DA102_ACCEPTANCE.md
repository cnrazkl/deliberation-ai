# DA-102 local functional verification — reviewed run-body deletion

Verified: 3 October 2026, primary repository `C:\Users\caner\Projects\DeliberationAI`.
Functional checks pass. Repository-wide dependency security acceptance is **open**;
this increment is not labelled fully security-accepted. [Current finding](DEPENDENCY_SECURITY_2026_10_03.md).

## Delivered scope

Reviewed removal of one owned terminal leaf run body before retention age, with bounded
copy/original archive inspection, unresolved provider/fence/ownership/schema guards,
exact affected-row fingerprint and atomic content-free encrypted usage/intent retention.
Grouping and independent billing/preflight/schedule inputs remain. Lost confirmations
can be manually replayed; original creation/rerun intent keys cannot resurrect content.
The owner's question/model draft remains; a removed active report view is cleared.
Decision aggregates, age-retention accounting unification and external/cascading erasure
remain outside scope. Migration 0047 is additive and was applied locally.

## Verification evidence

| Check | Result |
| --- | --- |
| `pnpm test` | 272 tests / 41 files passed |
| `pnpm test:integration:isolated` | 170 tests / 20 files passed in the final run |
| `pnpm test:e2e` | All 27 browser flows passed in the final full run |
| Workspace type checks | Passed |
| Zero-warning lint | Passed |
| Separate `.next-verify` production build | Passed |
| Local Gitleaks staged source and full Git history | Passed; no leaks reported |
| Full `pnpm audit --audit-level moderate` | Failed: one high unpatched lint-tool braces advisory |
| `pnpm audit --prod --audit-level moderate` | No known vulnerabilities reported |

Eight new PostgreSQL cases cover preview/no-write, populated known content closure
(models/claims/quotes/memory/evidence/captures/events/provider receipts), nullable/zero
usage, retained billing/preflight/schedule/grouping, exact child-row drift, concurrent
confirmation and tombstone replay, old creation-intent rejection, zero stale-worker
calls, unresolved/active/fenced work, owned private/continuation/detached copies,
foreign target/reference and cross-run graph guards, schema/incoming-FK/trigger drift,
unreadable peers, pending indexing, inspection overflow and all decision statuses.
The final added case finds root provenance inside nested frozen JSON after generated
intermediate-source retention, then permits separately reviewed leaf-first removal.

Actual populated `pg_dump`/`pg_restore` into a disposable database authenticates the
new run audit through exhaustive encrypted inventory, compares stored audit ciphertext
and confirms the removed body is absent. Existing native private bodies and retained
private deletion audit remain covered. Temporary restore databases/archives are cleaned.

Two new browser flows exercise review/cancel, strict/origin/size/stale guards, a lost
committed response followed by manual replay, nullable retained usage, unavailable
detail/export, conversation audit export, active report clearing, draft preservation,
copied history and active-state blockers with zero browser-requested generation.
Existing 25 flows also pass, including real-worker loopback provider fixtures.

Initial database fixture attempts omitted contract defaults and assumed two model rows
despite the default review round; those test constructions were corrected. The first
browser pass exposed an unrelated pre-existing foreign run disabling deletion globally.
Read-only inspection confirmed the condition; the ownership guard was narrowed to
target-associated foreign references/cascade relations, with an explicit regression
for unrelated foreign rows. No pre-existing owner/foreign record was altered or removed.

No paid/cloud model request, JEV activation, real owner-history pruning or real owner
content deletion ran. All destructive tests use generated fixture IDs, and integration
DDL/retention fixtures run in the disposable isolated database. This is not a model
quality measurement, billing/refund result or complete-account/forensic erasure claim.

## Remaining gate

The full dependency audit fails on GHSA-vfj7-8cjw-p6xm through Next lint development
dependencies. Production-only audit is clean; this does not close the full audit.
No advisory ignore, dependency override, unreviewed fork/patch or changed Security
workflow was introduced. Git publication keeps this failure visible; secret scanning
is a separate check and does not substitute for dependency acceptance.

Immediate priority: a verified upstream fixed release or separately reviewed compatible
mitigation. Reviewed preflight draft content deletion follows that gate. [Policy](RUN_DELETION.md),
[ADR](adr/0029-reviewed-run-body-deletion.md).
