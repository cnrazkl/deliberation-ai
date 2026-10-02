# Reviewed billing identity reallocation — DA-087

Use this workflow when reviewed billing evidence was attributed to the wrong invoice line or provider attempt. An explicit move creates a new immutable billing root and encrypted source-to-target event. Original ciphertext, amounts, document digests and DA-084 corrections remain available. Current duplicate guards move atomically; the original evidence is never silently overwritten.

## Operator workflow

Inspect the source with `pnpm billing:show <source-record-id>`. Copy its `currentFingerprint` into a strict `provider-billing-reallocation-v1` packet:

```json
{
  "version": "provider-billing-reallocation-v1",
  "sourceRecordId": "00000000-0000-4000-8000-000000000003",
  "expectedFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "documentSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "reviewedAt": "2026-10-01T10:00:00.000Z",
  "reason": "The reviewed source identifies another invoice line or attempt.",
  "replacement": {}
}
```

This is a synthetic envelope example. Replace the empty `replacement` with a complete [`provider-billing-v1` input](PROVIDER_BILLING.md), and replace every placeholder with reviewed evidence. The replacement must repeat the envelope's document digest and review time. At least one source/call identity must change: operation, connection, provider, requested model, remote response, statement or line. Amount-only/document-only revisions use [DA-084](BILLING_CORRECTIONS.md).

- `pnpm billing:reallocate:preview <absolute-json> <absolute-evidence>` validates without writes.
- `pnpm billing:reallocate:record` with the same arguments appends the new root/event and transfers current identity claims.
- `pnpm billing:show <source-record-id>` exposes `status: reallocated`, preserved original/correction history and `reallocationOut`.
- `pnpm billing:show <target-record-id>` exposes the new attribution and `reallocationIn`.

Use paths without spaces with the Windows root wrapper. JSON is limited to 64 KB and source bytes to 20 MB; reasons contain 1–500 trimmed characters. File SHA-256 is computed locally, without uploading or parsing the document. The owner must review its contents; matching bytes do not prove authenticity. Review times must be nonfuture and no older than the effective source review. Component amounts/credits must reconcile exactly in USD.

The target must be an available owned submitted receipt with a closed or unknown outcome, matching its frozen member/provider/model/connection and response id. A same-call line correction is allowed. Moving to a target identity claimed by another record is rejected; occupied-root merging/swapping and splitting one charge across calls are outside this workflow. A replacement creates fresh immutable evidence; an identical historical payload cannot be repurposed as a new root.

## Effective amounts, history and statement review

Only a current valid attribution contributes to the recorded subtotal. A moved-away call without another current attribution is pending, not zero or refunded. Same-call reallocation counts the replacement once. The usage panel displays moved-record coverage, reasons and direct source/target ids; token estimates, reports, copied outputs, provider outcomes and execution reservations are unchanged.

A void retains current claims until an explicit move. Reallocation can start from active or withdrawn evidence. A superseded source cannot receive fresh DA-084 changes or a second outgoing move; a new target may receive its own same-attribution corrections or a later move to another new root. Direct provenance links allow inspection of successive moves. The DA-084 100-change bound applies separately to each root.

Exact record/change/move retries never reactivate superseded claims or reset the head. Original-record intake still requires its owned receipt to be available; exact move replay remains available after run retention. Source history remains inspectable after deletion; a new target still requires an available owned receipt.

Statement inspection rejects an attempt line referring to a superseded root with `reallocated_record`. Superseded roots no longer require effective coverage, while voided roots still do. Link the new root/current fingerprint in a freshly reviewed packet. Existing saved packets and archived amounts remain immutable; `billing:statement:show` separately reports changed live evidence until a new successful statement version is reviewed and recorded. A move never automatically rewrites statement evidence.

## Atomicity, storage and restore

Migration `0039_melodic_kronos.sql` introduces current `provider_billing_claims` and immutable `provider_billing_reallocations`. It backfills every legacy root, including voided evidence, before replacing root identity uniqueness with claim uniqueness and owner/root-payload idempotency. Claims reserve operation, source line and connection/response identity. Both tables restrict deletion of their linked immutable roots; run/connection ids remain logical provenance.

Recording locks owned surviving source/target runs in stable id order, then the source root and target receipt, and rechecks evidence inside one transaction. The new root, event, old-claim removal and new claims commit together. Concurrent exact retries deduplicate; competing source-head moves or separate sources targeting one free receipt allow one winner without releasing the losing source. Run pruning and same-attribution correction share the existing locks.

Authenticated `provider-billing-reallocation:<id>:payload` contains the reviewed input and target fingerprint. Hydration verifies source/target ownership, immutable target contents/fingerprint, reviewed source head, request/event fingerprints and current claim consistency. Invalid linked evidence fails closed. These application checks do not remove database-administrator authority or provide an independent external ledger anchor.

Backups include roots, current claims and encrypted move events. Original source bytes, intake JSON, separate exports and the encryption key require protected separate preservation. Operator output contains sensitive accounting evidence.

## Local acceptance — 1 October 2026

Verification passed 226 offline unit tests, 81 isolated PostgreSQL tests, type checking, lint and production build. Eight new PostgreSQL tests cover preview no-writes, immutable originals, concurrent exact/competing moves, same-call and successive moves, void/occupied-target behavior, owner/receipt/evidence boundaries, statement freshness, retention replay, tamper rejection and actual CLI intake/show. Browser verification passed eleven flows in the full run; the follow-up flow initially timed out after refresh collapsed its details panel. The corrected test reopens the panel, and both follow-up/quota flows passed in the file repeat.

Migration 0039 is applied locally. Populated archive `deliberation-20261001T110303Z-b8f9b3811a5e.manifest.json` restored into a disposable database and verified 305 runs, 5,230 encrypted rows and 8,066 decrypted values across eleven populated tables, including the new move ciphertext. Generated billing/event/claim/run/receipt/connection/input/evidence fixtures were removed. Browser generation used only a local mock; no paid model call, real invoice/payment acceptance or JEV activation occurred.

Provider authenticity remains unverified, payment unknown and monetary dispatch unauthorized. Authoritative provider-account reconciliation, real-account acceptance and hard input/tool/money reservations remain open. Conversation continuation/compaction/branches/export remain a separate group.
