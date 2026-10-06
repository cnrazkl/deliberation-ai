# Local operations

Generated-only 0053→0054 upgrade and pre-upgrade snapshot rollback:
`pnpm knowledge:recovery:rehearse`. It checks three temporary databases without
owner-data writes or provider calls. Rollback restores earlier grant/receipt state;
later changes need reconciliation before real cutover. No old executable or clean
machine is verified. [Procedure](KNOWLEDGE_RECOVERY_REHEARSAL.md).

## DA-124 — backed-up owner deployment, 6 October 2026

The owner separately authorized applying pending additive migrations through 0054.
Pre-migration backup `deliberation-20261006T091815Z-8aeecbae6cf2.manifest.json`
and post-migration backup `deliberation-20261006T091929Z-3b0771e5f2fe.manifest.json`
were each restored into a temporary database and passed exhaustive encryption audit
(434 runs, 7,457 encrypted rows, 12,005 values). Archives/manifests stay under the
local application backup directory outside Git; retain the encryption key separately.
No owner source passage, run history or provider credential was rewritten/deleted.
Earlier generated-only migration notes below describe the original increment status;
this authorized deployment supersedes their pending-installation status.


DA-121 migration 0051 has been tested only in disposable databases; owner deployment
still requires a separately authorized backed-up migration of 0050/0051. Verify frozen
parser output with `pnpm knowledge:extraction:verify`. Generated-only restore/resource
check: `node scripts/with-root-env.mjs pnpm --filter @deliberation-ai/persistence exec tsx scripts/verify-knowledge-sources-restore.ts`.
It creates/restores/removes two generated databases and measures bounded local scans;
it never restores over owner data. Keep the separately managed encryption key and
review parser upgrades explicitly. No service/GPU is required; clean setup/monthly
maintenance time is unmeasured. [Operating limits](LOCAL_KNOWLEDGE_SOURCES.md),
[measurements](DA121_ACCEPTANCE.md).

DA-120 migration 0050 was exercised in disposable databases only. The owner's DB needs a separately authorized, backed-up migration before using the new backend APIs. Generated-only restore verification: `node scripts/with-root-env.mjs pnpm --filter @deliberation-ai/persistence exec tsx scripts/verify-knowledge-scope-restore.ts`. It verifies identical ciphertext/selection/revocation after custom-format restore in two disposable databases, then removes its generated databases/archive. Run retention preserves independent collection/grant/selection records. [Contract](KNOWLEDGE_SCOPE.md).

## DA-110 — separate interactive runtime from browser tests

On 3 October PostgreSQL was listening on 5432, but port 3000 and the application
worker were absent. The preceding Playwright `webServer` had owned `pnpm dev` and
removed its temporary web/worker tree at teardown; no independent interactive server
was left running. This explains the observed outage without evidence of a DB failure
or application crash.

Daily usage remains `pnpm db:start` then an independently running `pnpm dev` on 3000.
A hidden detached Windows launcher now runs from this worktree, with ignored logs in
`.local/runtime/dev.stdout.log` and `dev.stderr.log`. This is a current-session process,
not login/reboot startup or an automatic crash supervisor.

Playwright now owns `pnpm dev:e2e` on loopback 3100 with `.next-e2e/`. Its wrapper sets
the matching APP_ORIGIN after local env loading and forces test output; origin validation
is not relaxed. Generated output is excluded from Git/lint. PLAYWRIGHT_REUSE_SERVER,
if explicitly set, applies only to 3100. The worker/database/queues remain shared with
the configured local installation: this change separates process/output lifecycle,
not database state.

The first separate-port smoke failed with 403 due to the inherited 3000 origin. After
correcting the test origin, the real-route browser smoke passes. At teardown 3100
closes, while 3000 returns HTTP 200, the database/one interactive worker remain ready,
and the detached launcher survives across tool calls. Type checks, zero-warning lint,
script syntax check and separate production build pass. No schema migration, paid call
or real owner deletion. Remaining DA-108 work stays next; broader supervision is open.

DA-103 rollout: use `pnpm install --frozen-lockfile`, `pnpm test:lint-dependencies` and `pnpm lint` after checkout. The pinned alias and patch travel with source/lockfile; no database migration is needed. Preserve LF patch bytes and review both integration parts before upgrading Next lint. Full dependency audit is now clean. [Maintenance](DEPENDENCY_MITIGATION.md), [verification](DA103_ACCEPTANCE.md).

DA-102 rollout: apply additive migration 0047 with `pnpm db:migrate` and restart old processes before exposing reviewed run deletion. Migration was applied locally; it deletes no rows. The operation is explicitly reviewed, independent of age-based `db:prune`, and preserves independent preflight/schedule inputs and billing. Populated deletion audit is covered by disposable restore. Its original dependency finding was resolved by DA-103. [Policy](RUN_DELETION.md), [historical finding](DEPENDENCY_SECURITY_2026_10_03.md).

DA-101 rollout: apply `pnpm db:migrate` for additive 0045/0046 before using private deletion and restart any processes still running old code. Both migrations were applied in the primary local installation during acceptance; neither deletes rows. The retained audit's encrypted field joins disposable backup restore validation. Content deletion is an explicit reviewed UI/API operation, never an automatic retention sweep. Real owner history was not deleted; destructive acceptance uses generated fixtures. Restoring an older archive can restore deleted content. [Policy and limits](PRIVATE_BRANCH_DELETION.md).

To validate a production build while the local development server is in use, set `DELIBERATION_VERIFY_BUILD=1` only for the build command. It writes `.next-verify/`, leaving the ordinary `.next/` development output in place. For example in PowerShell: `$env:DELIBERATION_VERIFY_BUILD = '1'; pnpm build; Remove-Item Env:DELIBERATION_VERIFY_BUILD`. Do not set this flag on the normal development process. This is a verification output, not a deployment or automatic-start service.

DA-093 rollout: apply `pnpm db:migrate`, restart old app/worker processes, then run `pnpm db:conversations:index`. It completes branch indexing and atomically groups owned legacy runs; pending runs keep conversation views/exports unavailable. Limits and legacy missing-bridge semantics are explicit in [the conversation procedure](CONVERSATIONS.md). Backup includes the two metadata tables, while encrypted-field inventory remains unchanged.

DA-092 rollout: apply `pnpm db:migrate`, restart old app/worker processes, then run `pnpm db:branches:index`. This authenticated metadata upgrade is bounded/resumable; pending owned rows keep navigation unavailable. Restored legacy backups may need the same command. Source retention preserves descendant pointers without a foreign-key cascade. [Procedure](RUN_BRANCHES.md).

DA-089 adds `billing:payment:inspect <absolute-payment-json> <absolute-invoice-source> <absolute-payment-evidence-manifest>`. Embed a current DA-088 account packet, declare exact-invoice payments/refunds and map each entry to its reviewed local source. Files may support multiple distinct source lines. Exit 0 means local evidence reconciliation, 2 incomplete and 1 generic invalid intake/history. No payment/refund or durable record is created. Preserve all artifacts separately. [Guide](BILLING_PAYMENT.md).

DA-088 adds `billing:account:inspect <absolute-account-json> <absolute-invoice-evidence>`. First record/review one current statement slice per declared connection for the same invoice id/source digest; bind its head id/fingerprint and account mapping reason. Shared account charges must appear once. Exit 0 means local packet reconciliation, 2 means incomplete and 1 generic invalid input/history. Keep account packets, invoices and reports separately; the command writes nothing and verifies no payment. [Guide](BILLING_ACCOUNT.md).

DA-087 adds `billing:reallocate:preview <absolute-json> <absolute-evidence>` and `billing:reallocate:record` with the same arguments. Inspect the source using `billing:show`, bind its current fingerprint and supply a complete replacement with at least one changed source/call identity. Preview writes nothing; record atomically creates a new root and transfers current claims. Use `billing:show` on either root to inspect provenance, and re-inspect/review saved statements after a move. Apply migration `0039` before using the feature. [Guide](BILLING_REALLOCATION.md).

DA-086 adds `billing:statement:preview <absolute-change-json> <absolute-evidence>`, `billing:statement:record` with the same arguments, `billing:statement:list` and `billing:statement:show <version-id>`. First recording uses a null expected head; later revisions/withdrawals use the reviewed current head fingerprint. Show returns full history plus live freshness; exact retries return the old version without reapplying it. Keep source bytes separately; saved packets/inspections now join encrypted backups. [Workflow](BILLING_STATEMENT_HISTORY.md).

DA-085 adds `pnpm billing:statement:inspect <absolute-json-path> <absolute-evidence-path>`. It writes nothing; exit 0 is a locally reconciled owner packet, 2 an incomplete report and 1 an input/evidence/history failure. Preserve source files and any saved report separately; review refreshed record fingerprints after corrections. [Format and limits](BILLING_STATEMENTS.md).

DA-084 adds `billing:change:preview <absolute-json-path> <absolute-evidence-path>` and `billing:change:record` with the same arguments. Inspect `billing:show` for `currentFingerprint`, review a replacement or void packet, preview without writes, then record. Original evidence and complete history remain accessible; stale edits need fresh review. Source documents remain outside backups. [Examples](BILLING_CORRECTIONS.md).

DA-083 adds `billing:preview <absolute-json-path> <absolute-evidence-path>`, `billing:record` with the same arguments, `billing:list` and `billing:show <record-id>`. Preview writes nothing. Record freezes owner-reviewed evidence and rejects conflicting duplicates; it cannot overwrite an attribution. Keep source documents separately, since backups retain their hashes only. No real invoice was imported during implementation. [Workflow](PROVIDER_BILLING.md).

DA-082 adds `pnpm pricing:record <absolute-json-path>` and `pnpm pricing:list` for immutable owned token-price observations. Use a path without spaces with the Windows wrapper. Observations expire within 31 days; connection edits require a new version. No rate is seeded, source URL fetched or model called. Future qualifying attempts display estimates automatically. [Format and limits](PROVIDER_PRICING.md).

The provisioned Windows workspace runs PostgreSQL 18.6 from `%LOCALAPPDATA%\DeliberationAI\postgresql-18.6`. It is a user process bound to `127.0.0.1:5432`; the application role authenticates with SCRAM and secrets remain in ignored local files.

```powershell
pnpm db:start
pnpm db:status
pnpm db:migrate
pnpm dev
```

`pnpm dev` starts the Next.js BFF and the pg-boss worker together. Stopping those processes does not stop PostgreSQL or remove queued jobs. Restarting them resumes queued work from the database.

Browser tests own a temporary `pnpm dev` process and stop it when the test run ends. A successful test/build does not leave an interactive application running. After tests/build, start the ordinary development process when handing the application back for use; verify port 3000 and `/api/local-diagnostics` (database ready and one ready worker). Keep build and browser tests sequential because they share `.next` output. A background Windows launch must use a hidden window and redirect logs to ignored `.local/` files; it is a manual session, not an installed auto-start service.

Open “Yerel çalışma durumu” at the top of the app to inspect the database connection, recent worker heartbeat, queued/running run counts, unresolved provider attempts and active schedules. It refreshes every 30 seconds or when you press “Durumu yenile”. “Worker hazır” requires a recent heartbeat from an active database session; a stopped or crashed worker may take up to 45 seconds to show as unavailable. This status check makes no provider request and does not prove that a specific provider key works. If queued work or active schedules exist while the worker is unavailable, restart `pnpm dev` and inspect unresolved attempts before authorizing any retry.

The web server listens on `127.0.0.1:3000`. Before submitting a question, the UI shows an approximate first-round token count including selected context and opted-in images. This preview is computed locally and does not spend provider tokens. After a run, “Sağlayıcının bildirdiği token kullanımı” shows counts returned for recorded attempts; missing counts and ambiguous outcomes are identified. Use the provider's own billing records for exact charges, since this view has no price ledger or cost guarantee.

After a run finishes, use “Raporu indir (JSON)” in its status card to save a single-run report. It includes the question, model output, reviews and claim provenance as plaintext; keep the file in a private location and remove it when no longer needed. Connection keys and attachment file bytes are not included. The button is unavailable while the run has no terminal report, and downloading does not call a provider.

“Son çalışmalar” shows the newest 20 local runs, with a control to load older pages. Use “Çalışmayı aç” to restore a saved report after a page refresh; an active run resumes live progress observation. Use “Listeyi yenile” for runs created by schedules or another open tab. Opening a saved run does not alter the current draft task configuration or cause a new model call.

The research capture button makes outbound requests only after the owner submits a URL. It needs no API key or worker flag. Direct mode supports public HTML, plain text and selectable-text PDF on ports 80/443; websites may still refuse the fixed user agent. PDF parsing is capped at 100 pages, 64,000 characters and ten seconds. Optional browser mode is for JavaScript-rendered text and applies the same private-network rejection plus 20-request, 5 MiB and 15-second limits. No scheduled crawler or automatic citation fetch runs in the background.

The local MCP panel connects only to a Streamable HTTP server on loopback, such as `http://127.0.0.1:3001/mcp`. Saving a connection does not execute anything. Use “Araçları getir”, inspect the schema, enter a JSON object and invoke explicitly; then select up to three stored text results for a run or enable lexical top-3 retrieval.

Local schedules are daily or weekly and always start paused. Activation authorizes future runs using the frozen question/member configuration. The worker checks at startup and every 30 seconds; stopping `pnpm dev` prevents execution, and starting it later queues an overdue active occurrence. Pause or delete schedules before changing provider credentials or model availability.

JEV decision execution ships disabled. Saving a TypeSafe connection only encrypts it locally. For the later live pilot, set `ENABLE_DECISION_EVALUATOR=true` deliberately and optionally tune `DECISION_WORKER_CONCURRENCY` (default `1`) before starting `pnpm dev`. Keep the first live run in shadow mode. Turning the flag back off prevents new assessment creation and stops the worker from registering the decision queue; it does not delete stored assessment history. Normal tests never require this flag or a real key.

Use `pnpm db:stop` for a fast, clean local database shutdown. On a newly provisioned copy of the same portable layout, `pnpm db:setup-portable` creates or rotates the application role, creates the database, enforces SCRAM host authentication, and verifies the application connection. Do not commit `.env.local` or the local administrator secret.

For a recoverable local snapshot, stop `pnpm dev` and any other worker first so no provider call is in flight, but leave PostgreSQL running. Then run:

```powershell
pnpm db:backup
pnpm db:backup:verify
pnpm db:backup:rehearse
```

`db:backup` writes a PostgreSQL custom-format archive under `%LOCALAPPDATA%\DeliberationAI\backups`, restores it into a randomly named temporary local database, and publishes its SHA-256 manifest only after verification succeeds. Failed attempts leave no published manifest or new archive. Verification checks application/queue tables and every non-null encrypted database field without printing plaintext; newly added ciphertext columns fail closed until covered by the verifier. The temporary database is dropped afterward; the active `deliberation_ai` database is never a restore target. `db:backup:verify` rechecks the newest published manifest. `db:backup:rehearse` also prints counts by run and provider-operation status plus active schedules so the operator can identify work requiring reconciliation before a replacement cutover. To inspect a different saved manifest, set `DELIBERATION_BACKUP_MANIFEST` to its full path for either command. A changed or truncated archive fails checksum validation before a temporary database is created.

The archive may contain sensitive metadata and encrypted user data. It does **not** include `.env.local`; store that file securely with the archive because `DATA_ENCRYPTION_KEY` is required to read encrypted records. Keep both outside Git and outside any shared folder. A successful temporary restore proves that this archive can be loaded on this PostgreSQL installation and that every stored non-null ciphertext envelope can be opened with the current key. Empty encrypted tables/fields cannot be key-checked, and this does not validate report semantics. The rehearsal never resumes jobs, retries submitted/unknown provider operations, activates schedules or replaces the live database. Restoring into a replacement installation, reconciling those records and rollback remain separate work.

`pnpm db:encrypt-existing` encrypts legacy plaintext rows and is safe to rerun. `pnpm db:prune` is a read-only preview: it prints the number of this local owner's terminal runs whose **finish time** is older than `RUN_RETENTION_DAYS` (default `30`) and the cutoff. It does not delete data. Queued/running runs, terminal runs without an old finish time and runs with unresolved provider/decision attempts are retained. After reviewing the preview and making a backup, `pnpm db:prune:apply` removes eligible runs, their run-owned records and recorded council/decision queue jobs in one database transaction; the count may differ if runs change between commands. A schedule remains but its last-run link is cleared when that run is deleted. Integration tests restrict deletion to generated fixture ids; they never prune the owner's existing history.

This prune command does not remove earlier archives or locally downloaded JSON files, so it is not a complete account-deletion workflow. Back up both the database and `.env.local` together: replacing `DATA_ENCRYPTION_KEY` after data has been encrypted makes that data unreadable until a key-rotation workflow is implemented. Replacement-installation cutover, external-copy deletion and key rotation remain open.

## DA-108 — local migration and restore

Migration 0049 was reviewed and applied locally after verified backup deliberation-20261003T134321Z-66ad7c86a96e.manifest.json. Post-migration backup deliberation-20261003T140520Z-50ca0cafe493.manifest.json restored and passed exhaustive encryption audit (398 runs, 6831 encrypted rows, 10879 values). Backups remain outside Git under the local application backup directory; retain the encryption key separately.

Generated-only populated restore: node scripts/with-root-env.mjs pnpm --filter @deliberation-ai/persistence exec tsx scripts/verify-council-template-restore.ts. The script creates two disposable databases, migrates/dumps/restores synthetic templates, validates identical authenticated receipts and replay protection, then removes only its generated databases/archive. No owner history is deleted. Interactive runtime remains independent of the full browser suite.

## DA-111 — settings and appearance location

Provider connections, local MCP configuration/results and DB/worker diagnostics are reached through Ayarlar in the sidebar. Zamanlayıcı contains scheduling and latest linked run outputs; older runs remain in sidebar history. Appearance is selectable in the sidebar or Ayarlar and stored only as a non-sensitive browser preference. Menu changes do not stop a worker or pause schedules. Runtime health endpoints and independent 3000/3100 lifecycle remain unchanged. [Design](UI_DESIGN.md).

## DA-122 reviewed local source packets

Migration 0052 has been exercised only in generated databases. A generated-only packet/source archive rehearsal runs with node scripts/with-root-env.mjs pnpm --filter @deliberation-ai/persistence exec tsx scripts/verify-knowledge-packets-restore.ts. It migrates, prepares/freezes/cancels a synthetic run, revokes the grant, dumps/restores, verifies exact historical quotations and revoked denial, then removes only generated databases/archive. Keep the encryption key separately; preserve the immutable preparation trigger. [Contract](KNOWLEDGE_PACKETS.md).
