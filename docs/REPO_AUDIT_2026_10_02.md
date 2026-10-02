# Repository review and DA-094 acceptance — 2 October 2026

The current application is `C:/Users/caner/Projects/DeliberationAI`; the synced ChatGPT-project sources remain read-only reference material. DA-094 is now verified in the primary installation. Its source files were already present at the start of this follow-up: all 19 prepared targets matched the reviewed copy after normalizing line endings. The old documentation incorrectly continued to describe persistent application as pending; the patch was not applied again.

## Review scope and findings

The initial inventory covered 425 source, document, workflow and test files (426 after adding the regression) across eight packages, web/worker applications, provider adapters and PostgreSQL migrations. Contributor instructions, product/architecture/state/tasks, the gap audit and relevant conversation/history, worker/provider-receipt, encryption and retention boundaries were inspected. Broader regression suites supplement this review; it is not exhaustive proof of every path or factual model quality.

- DA-094 adds `GET /api/conversations` and **Kayıtlı konuşmalar**. Pages contain 20 owned conversations, counts of recorded/available/unavailable members and one latest available question. Metadata-only conversations remain visible with opening disabled. Saved-run opening preserves the question/model/continuation draft and creates no generation.
- Owner-scoped read-only repeatable-read queries compare timestamp/UUID cursors inside PostgreSQL. No reports, private archives, attachments, credentials or accounting bodies are fetched. Responses are `no-store`; malformed cursors return 400, unknown/foreign cursors 404 and pending owned legacy grouping 503. Discovery is a metadata projection; complete detail/export retains its graph and size validation.
- Saved-run and child/sibling cursors previously rounded database timestamps to JavaScript milliseconds, skipping rows within the same millisecond. The prepared source fixes preserve full database precision; five new PostgreSQL regressions cover those paths and discovery.
- The additional primary review reproduced a saved-history race in the browser: refresh produced one new row, then an older response incorrectly appended another. The regression failed with expected 1 / received 2 before the fix. The panel now aborts and fences first/older-page responses, errors and loading state through manual/status refresh and unmount. Synchronous guards prevent overlapping paging/opening. The same regression passes afterward with the draft preserved and zero generation requests.
- The repository still has no initial Git commit and all application files are untracked. No staging or commit was performed. This limits diff-based history; the current changes are the saved-history guard, its regression and synchronized documentation. Database backups do not establish source-code version history.

## Current primary verification

- **252 unit tests** across 40 files passed.
- **127 PostgreSQL integration tests** across 16 files passed in a randomly named disposable database on the provisioned local PostgreSQL server. The generated database was dropped; the active application's database was not replaced or migrated.
- The full **17-flow Playwright run** passed 16 flows, including both conversation-library flows and the new saved-history race/retry regression. One existing council flow encountered `ECONNRESET` on an API read. Its focused repeat passed without a source change. Server logs showed no crash and diagnostics remained ready; the cause of that isolated reset remains unknown. This is 16 passing flows plus one passing repeat, not a claimed clean 17-flow single run.
- All package, web/worker and root-script type checks and lint with zero warnings passed after the UI fix. The 13 changed files have no trailing whitespace; normalized comparison of the complete source/document/test inventory against the reviewed copy found only the intended history panel, new regression and documentation changes.
- Normal Next.js 16.3.6 Turbopack production build passed in `.next-verify`; the existing development server was not stopped and its `.next` output was not used for the build.
- The current `pnpm audit --audit-level=moderate` reported no known vulnerabilities. This is the registry result at the time of the check, not a guarantee that every dependency is secure.

The earlier isolated preparation separately passed 252 unit / 127 integration / 16 browser tests using a fresh PostgreSQL 18.6 cluster on port 55432 and a separate review web/worker. Its original linked-dependency copy failed Turbopack workspace resolution; copied local dependencies allowed the normal build to pass. Those preparation checks are historical evidence, distinct from the current primary checks above.

All browser generation uses local mocks or deterministic fakes. The history-race regression uses only mocked list responses. Existing browser suites can retain generated saved reports; their recorded fixture connections are cleaned by their test hooks. No paid/live model call, JEV activation, account/payment action, owner-history pruning or live-data migration occurred. No backup restore was repeated because no schema or encrypted-field inventory changed.

## Runtime and remaining work

At the start, the local app and PostgreSQL were not listening. PostgreSQL and a separate hidden local web/worker process were started through the normal project workflow, with logs in `.local/dev-server.*.log`. Live checks return `/` and `/api/conversations` successfully; diagnostics report database ready, one ready worker, zero queued/running runs, zero unresolved provider attempts and zero active schedules. The app remains open at `http://127.0.0.1:3000/`. Automatic reboot startup is not implemented.

DA-094 local acceptance is complete. No migration, package version, encrypted column, provider prompt, dispatch policy or retention rule changed. Next conversation work is model-private message/branch management and an explicit metadata-deletion policy. Human labeling, empirical quality, semantic compaction fidelity, provider-authoritative settlement, hard input/tool/money enforcement and replacement-installation recovery remain open.
