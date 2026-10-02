# Local application audit — 29 September 2026

The review used the persistent application at `C:/Users/caner/Projects/DeliberationAI`, canonical product/architecture/task/gap records and offline test suites. The synced ChatGPT mirror was not changed. The app remains local-only; TypeSafe/JEV stays disabled and unavailable human/paid-model acceptance evidence remains open.

The scan covered workspace/dependency configuration, contracts, claim/risk/coverage rules, analysis/review barriers, queue/receipt/retry/cancellation paths, provider adapters, history/export/usage, prompt preflight, attachments, evidence/retrieval, local tools/schedules, encryption/backup/retention and browser mutation/progress flows. Tests validate software behavior, not model accuracy, semantic completeness or replacement-installation recovery.

## Fixed defects

1. Concurrent run submissions could both observe no idempotency row and the second hit a unique-index error. An owner/key transaction advisory lock now serializes the absent-row case before checking runs or consuming a preflight draft. A conflicting payload still fails. Follow-ups use the same lock, so concurrent copies return one child and create one queue job.
2. A POST could commit while its response was lost; the browser then generated a fresh key on retry. It now retains the same key for an unchanged council/follow-up intent until a response is read. Synchronous guards block overlapping clicks before React renders. This state lasts for the mounted page; refresh is not a cross-session retry protocol.
3. A delayed start response could replace another saved run opened meanwhile. The response refreshes history and changes focus only if the initiating source is still selected (or no other run was opened during ordinary submission).
4. Follow-up enqueue checked only the selected connection even when reviews needed every member. It now checks all required connection/provider identities. A later connection edit/deletion can still affect execution because credentials/settings are not frozen per run; this existing limitation is preserved explicitly.
5. Adapters discarded available usage when a returned answer failed council JSON validation. Observed usage now travels with the non-enumerable normalized failure and is saved on its encrypted failed receipt. Invalid optional counts are excluded without breaking a valid answer. Unknown network usage remains unknown.

## Next delivered increment

DA-080 implements independently executable usage visibility: observed total, cache and reasoning/tool-input counts, metric-specific completeness, native conventions and saved-run detail. [Protocol and limitations](PROVIDER_USAGE_DETAILS.md). It requires no paid request or migration. Semantic synthesis, empirical correctness gates and hard budgets are not marked complete.

`CURRENT_STATE.md` and `TASKS.md` record verification. Regressions cover concurrent enqueue/follow-up, a committed-but-lost browser response, malformed-output usage persistence and aggregation beyond the latest 100 rows. Retention tests use generated fixtures in a disposable integration database; no real owner history was pruned.

Final checks passed: 194 unit tests, 34 isolated PostgreSQL integration tests, 11 browser flows, type checking, lint, production build and `pnpm audit` (no known vulnerabilities). The initial browser pass exposed an outdated mocked usage DTO; the fixture was updated and the UI also tolerates missing legacy detail fields before the full suite passed. The app was restarted only after read-only checks found no active owner runs or ambiguous attempts. Final HTTP status is 200; database and one worker are ready, with queued/running/unresolved counts all zero.
