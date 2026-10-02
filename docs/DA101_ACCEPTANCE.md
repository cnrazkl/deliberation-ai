# DA-101 local acceptance — reviewed private branch content deletion

Accepted: 2 October 2026, primary repository `C:\Users\caner\Projects\DeliberationAI`.
This verifies the local reviewed leaf-first content boundary, not complete account,
external-copy or forensic erasure. No paid/cloud request or real owner content deletion ran.

## Delivered

Read-only preview and strict reviewed confirmation remove one owned branch's stored
seed/messages/request/reply text after copy/pending/worker/schema checks. Retained
encrypted content-free usage/provenance enters conversation export and backup audit.
State drift rejects confirmation; concurrent/lost-response manual replay returns one
audit. Deleted original create/fork intent IDs cannot recreate content. Cancelling
preserves unsaved draft; confirmed deletion keeps it separately on the current page.
Additive migrations 0045/0046 were applied locally and introduce no row deletion.

## Final verification

| Check | Result |
| --- | --- |
| `pnpm test` | 272 tests / 41 files passed |
| `pnpm test:integration:isolated` | 162 tests / 19 files passed |
| `pnpm test:e2e` | All 25 browser flows passed in final full run |
| Workspace type checks | Passed |
| Lint with zero-warning requirement | Passed |
| `DELIBERATION_VERIFY_BUILD=1; pnpm build` | Passed, separate `.next-verify` output |
| `pnpm audit --audit-level moderate` | No known vulnerabilities reported |

Six new generated PostgreSQL cases verify preview/no-write, stale/concurrent replay,
old creation-intent denial, copied terminal usage and source survival, leaf-first
deletion, empty metadata/audit survival, zero stale-worker provider execution,
prepared/submitted/unknown and held-worker-lease guards, detached/foreign origins,
schema/FK/trigger drift rollback, unreadable peers and the 1,001-row inspection cap.

The browser flow verifies real UI review/cancel, copied-parent blocking, separate
unsaved draft preservation, strict confirmation/origin/size guards, concurrent append
staleness and a committed-but-lost HTTP response followed by manual replay. Active
detail/export are unavailable after removal; retained audit contains usage without
fixture input/reply/draft text; council draft remains and no generation is requested.
Initial focused test attempts needed a role-based controlled-textarea locator and the
export route's existing POST method. These were test corrections; the final full run
passed and does not establish that every possible UI/network race is prevented.

The populated archive test removes only a generated Gemini branch into retained audit,
then uses actual `pg_dump`/`pg_restore` into a disposable database. Exhaustive encrypted
inventory authenticates/decrypts strict audit, stored audit ciphertext matches source,
and the removed active branch is absent. Native Anthropic/Responses active receipts
also remain covered. Generated fixtures/temporary restore databases are cleaned by tests.

## Limits and next work

Usage and identifiers remain deliberately retained. Old backups/exports may contain
deleted text; local draft, storage remanence, full account deletion and billing/refund
are outside acceptance. Inspection/audit caps and unreadable peers fail closed. No live
provider/model-quality evidence or public authentication/deployment gate is closed.

Next: reviewed retained run-body deletion beyond age-based retention, with copied
archives, unresolved receipts, accounting and metadata consequences defined.
[Policy](PRIVATE_BRANCH_DELETION.md), [ADR](adr/0028-reviewed-private-branch-deletion.md).
