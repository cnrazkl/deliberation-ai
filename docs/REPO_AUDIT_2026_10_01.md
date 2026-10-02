# Local repository audit and DA-081 acceptance — 1 October 2026

The persistent application at `C:/Users/caner/Projects/DeliberationAI` was reviewed against contributor instructions, product/architecture records, current tasks and the original-plan gap audit. The synced ChatGPT-project mirror was left unchanged. The first unfinished technical checkpoint was DA-081 acceptance, so this increment completes its checks before adding another feature.

The scan covered workspace dependencies, contracts/domain invariants, application prompt/review flow, worker receipt/replay/retry/cancellation, persistence and encrypted fields, preflight drafts, schedules and selected-member children, provider cap mappings, browser quota/usage controls and backup/retention boundaries. Existing module suites also exercise attachments, retrieval, local tools, provenance, exports, evaluation arithmetic and owner scope. This is a software audit with targeted source review and regression verification, not proof of every possible execution path or model accuracy.

## Corrections

- The new exhaustion test expected `ExecutionLimitsExceededError` from operator retry resolution, which correctly exposes `ProviderOperationResolutionError` to its route. The expectation now follows that existing API contract and still checks that the run, report, queue link, events and reservations remain unchanged.
- The new fixture cleanup interpolated a JavaScript array as a SQL record before casting it to `text[]`. It now uses a parameterized membership expression limited to generated fixture ids. Integration databases are disposable; no owner retention apply command was run.
- The browser quota test selected every alert, including Next.js's route announcer, and used an exact label lookup that included the select's option text. It now scopes errors to the quota panel and selects the round control by its combobox role.
- The quota explanation no longer says separately reported thinking is excluded from output caps. Output-cap semantics remain provider-specific as documented in [the execution-limit contract](EXECUTION_LIMITS.md); input tokens, tool charges and money remain outside this policy.
- Dependency audit discovered [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j). Next.js and its matching ESLint configuration were pinned from 16.3.5 to patched 16.3.6. Source search found no `next/og` or `ImageResponse` use, so this review does not claim the advisory's SVG attack path was reachable. The final dependency audit reports no known vulnerabilities.

## Acceptance evidence

- 206 offline unit tests across 32 files passed, including explicit cap bounds, rejection before provider network calls and native adapter mappings.
- 46 PostgreSQL integration tests across six files passed in a generated isolated database, which was removed after the run. Tests cover atomic parallel reservations, exhausted local rejection without delegate dispatch, successful receipt replay after reconnect, unknown/discard preservation, authorized retries consuming fresh capacity, draft resumption, encrypted schedules and inherited child quotas.
- Both populated execution-limit ciphertext fields passed exhaustive audit. A wrong authenticated context for either field is rejected in a transaction rolled back after the regression test.
- Type checking, lint and a production build with Next.js 16.3.6 passed. Migration `0033_light_warbound.sql` was applied to the local database and also exercised through fresh isolated migrations.
- All 12 browser flows passed across the full updated-version run (11 passed, one quota locator failure) and the corrected quota/follow-up file repeat (both passed). The repeat verifies no run/schedule request on invalid limits, adapter-request caps, usage display, parent/child reservations and idempotent recovery after a committed response is lost.
- Fresh backup `deliberation-20260930T211817Z-544717b8061c.manifest.json` restored 280 runs, checked 4,800 encrypted rows and decrypted 7,329 values across ten populated tables. The archive contains generated cancelled-run and paused-schedule fixtures so both new quota ciphertext fields were populated during restore; those two records were removed from the live database afterward. They created no queue jobs or model requests. The archive timestamp is UTC; local verification date is 1 October 2026.

The backup was restored into a generated temporary database, not over the running database. It verifies readability and column inventory, not replacement-installation recovery, cutover or rollback.

## Remaining boundaries

DA-081 is a per-run council dispatch policy. It does not settle invoice cost or enforce input-token, tool-charge, monetary, schedule-lifetime or account-wide budgets. Missing provider counters remain unavailable. No paid model call, JEV activation, human accuracy acceptance or automatic semantic early stop is supplied by these checks.

After this checkpoint, the next open usage task is versioned price observations and an auditable settled-cost ledger, followed by enforceable input/tool/money reservations. Conversation continuation and the separately documented human/semantic and recovery gates remain open in [the task list](TASKS.md).
