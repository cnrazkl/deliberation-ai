# DA-096 local acceptance — private draft foundation

Accepted: 2 October 2026, primary repository `C:\Users\caner\Projects\DeliberationAI`. The synced planning mirror was not modified. This accepts encrypted selected-member draft/branch management, not actual private model chat or completed conversation erasure.

## Change

Added strict draft/seed/intents contracts, `conversation_private_branches` migration `0044_vengeful_anita_blake.sql`, bounded encrypted owner persistence, source/parent review guards, create/message idempotency, append/fork concurrency protection and source-retention survival. Added no-store owned API routes, explicit selected-reply review, draft storage/fork/reopening/download UI and additive private bodies in the existing complete conversation snapshot export. Source/council/provider behavior is unchanged.

DA-095 explicitly registers the private table, restrictive FK and private-content blocker; any copied seed is retained content even without owner messages. The exhaustive backup inventory audits the new body with metadata/revision/copy binding. Restore checks source conversation membership and any surviving parent's owner/source identity. Whole-table absence supports pre-DA096 archives; partial/unknown ciphertext inventory fails closed. [Contract and limitations](PRIVATE_BRANCHES.md).

## Checks

- 252 offline unit tests, 40 files: passed.
- 144 isolated PostgreSQL tests, 18 files: passed. Nine new cases cover selected-only scope/strictness/encryption, seed drift, concurrent create/message replay, copied-prefix forks, actual fixture retention, ownership/body drift, message/list/UTF-8 bounds, populated backup consistency and pre-table archives. The schema-removal fixture runs only in the disposable integration database and rolls back.
- Complete browser suite: all 20 flows passed against the independent existing server. The private flow includes cancelled/stale source review, actual committed-response loss with exactly one message after retry, concurrent-view revision conflict with draft preservation, independent prefix fork, unsaved text preservation, source-deleted reopening, explicit JSON parsing, retained private-body deletion blocking, strict/origin/byte guards and zero generation.
- After final size-before-read/source-lock hardening: full 144-test isolated suite, private browser repeat, type checks and lint passed. Final separate-output build passed; the user development server was not stopped for compilation.
- First integration run exposed empty claim lists in new synthetic report fixtures, correctly rejected by the existing provider-output contract. Fixtures were corrected without weakening validation; the complete repeat passed.

## Populated backup and restore

A temporary helper created only new random fixture identities: one synthetic owned source/report, two private branches, an owner message copied into the child and a child-only message. It then pruned only that explicitly generated source UUID, preserving the branch copies and retained membership. No model operation was queued or submitted.

`pnpm db:backup` published `deliberation-20261002T083411Z-4cea2b2ef5a1.manifest.json` only after disposable restore/audit succeeded. An explicit `pnpm db:backup:verify` repeated the check successfully:

- 340 retained runs.
- 5,845 encrypted rows; 9,143 decrypted values; 11 populated encrypted tables.
- 353 conversations, 366 memberships, 27 unavailable bodies and **2 populated private branches**.

The active-database generated conversation/branch/membership identities and helper/state files were removed afterward; existing owner history was not deleted. The published archive intentionally retains the synthetic verification copies along with the owner's existing backup snapshot. Replacement-installation cutover, key rotation and old backup/export erasure are not proven.

## Runtime and remaining scope

PostgreSQL was initially stopped. Startup was followed by a bounded read-only inventory confirming zero active runs/schedules before the hidden web/worker process was launched. Delivery checks show the app and conversation library reachable and database/worker ready. Continued session/process uptime and automatic startup remain separate work; no prevention claim is made.

Actual one-model send/reply generation, reviewed delivery/risk/connection checks, durable provider receipts/unknown outcomes, call/output reservations, usage/billing, cancellation, message editing/deletion and private-body/copy erasure remain open. Source risk/configuration is archived provenance, not fresh input validation or a verified connection. Drafts and copied replies do not enter canonical claims, synthesis or council input. No paid/live-provider call, JEV activation, real-account acceptance or accuracy claim occurred.
