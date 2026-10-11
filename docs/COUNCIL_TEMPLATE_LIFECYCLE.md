# Saved council-template lifecycle — DA-108

Workspace deletion review now opens in a centered modal outside the template card,
preserving page position/focus. The acknowledgement, exact fingerprint, retained
copy warning and durable retry/deletion contract below are unchanged.

Verified 3 October 2026. Reviewed deletion and durable creation retries are complete.

## Saving and retrying

The chat **Konsey Havuzu** saves ordered members together with optional review-round
and self-revision settings. New browser saves always supply both settings. Selection
restores them without sending; legacy member-only content applies 1/false. Modified
drafts are shown separately and can be saved under a new name. Conflicting names are
still rejected. The current question/context/quotas are not reusable template content.
Complete content is encrypted as a strict versioned v2 envelope in the existing column;
legacy member arrays and creation hashes remain supported. Retry comparisons include
settings when present. Deletion clears the full envelope with the existing tombstone.
No DDL is introduced; rollback needs a reader supporting the v2 format.

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
