# Saved council-template lifecycle — DA-108

Verified 3 October 2026. Reviewed deletion and durable creation retries are complete.

## Saving and retrying

New creation requires a UUID requestId. The UI retains it for retries of an unchanged name, description and ordered member draft. Changed drafts start a fresh identity. An unchanged retry returns the original row without rewriting ciphertext or timestamps. Changed content, a conflicting active name, missing/foreign update ids and deleted identities return 409. Explicit updates supply only id and preserve the original creation hash. Neither/both identity fields return 422.

Owner/request uniqueness survives deletion; owner/name uniqueness applies to active rows. A fresh requestId can reuse a deleted name; an old identity cannot attach to it. Legacy rows retain nullable creation metadata; no historical request identity is inferred.

## Reviewed deletion

Silmeyi incele opens review beneath the selected card. Cancelling preserves the question and selected members. Explicit acknowledgement covers content removal and retained copies. Confirmation includes the reviewed fingerprint; changed rows require fresh review and acknowledgement. Refresh recovers committed deletion after a lost response. Matching repeated confirmations return the same receipt.

GET /api/council-templates/[id]/deletion previews; POST confirms. Strict same-origin bodies are capped at 4 KiB and must match the path id. Old immediate DELETE returns 405. Saving/review/deletion submit no generation.

Preview uses repeatable-read inspection, a 1 MiB row cap and exact PostgreSQL timestamps including microseconds. Confirmation reinspects under owner advisory/table locks with bounded timeouts. Column/type/nullability, FK, custom-trigger, member-count-check and unique-index drift block mutation.

## Retained state and copies

Deletion clears name/description and stores authenticated encrypted empty members. The hidden row retains id, owner, original creation identity/hash, member count, timestamps and an encrypted content-free receipt containing the reviewed fingerprint. Receipt authentication uses council-template:<id>:deletion-receipt. Restore auditing rejects inconsistent metadata, residual content and corrupt receipts. Retained hashes do not promise resistance to guessing known candidate content.

Current browser drafts, frozen runs, independent schedules, queue work, usage/billing, backups, exports and physical storage copies remain. This removes one reusable configuration.

## Migration and verification

Reviewed additive migration 0049 was applied locally after a verified pre-migration backup. Existing rows remain intact. Post-migration backup restoration and exhaustive encrypted-field auditing passed. Generated-only custom archive restore preserved identical ciphertext/receipt/row metadata, hid tombstones, rejected original creation replay and permitted fresh name reuse. [Acceptance](DA108_ACCEPTANCE.md).

281 units, 203 isolated PostgreSQL cases and all 31 browser cases pass, together with type checks, zero-warning lint, separate-output build and dependency audit. Destructive tests used generated fixtures only; no real owner deletion or paid provider call occurred.
