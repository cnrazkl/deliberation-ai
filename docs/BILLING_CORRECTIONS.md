# DA-084 — append-only billing corrections

DA-087 adds a separate [reviewed source/call identity reallocation](BILLING_REALLOCATION.md) workflow. This same-attribution workflow preserves identity; a superseded root accepts no fresh changes, while exact historical retries remain idempotent.

An owner can replace the reviewed amounts/document or void an existing billing attribution without editing its original ciphertext. Every change carries a reason, evidence digest, review time and the fingerprint of the version reviewed. The ledger folds the original plus its ordered changes into one current attribution; it never sums both an original amount and its replacement.

The feature changes only local, owner-reviewed accounting evidence. A void means that attribution is withdrawn, **not that the provider charge was refunded or zero**. Voided calls are excluded from the recorded subtotal and counted as pending again. Replacing a void with newly reviewed evidence restores that same attribution. Token estimates, provider outcomes, dispatch reservations, run reports and follow-up copies remain unchanged.

## Operator workflow

Inspect the current attribution first, prepare a change JSON and review its local evidence file:

```powershell
pnpm billing:show 00000000-0000-4000-8000-000000000003
pnpm billing:change:preview C:/Users/caner/Projects/DeliberationAI/.local/billing-change.json C:/Users/caner/Projects/DeliberationAI/.local/evidence.pdf
pnpm billing:change:record C:/Users/caner/Projects/DeliberationAI/.local/billing-change.json C:/Users/caner/Projects/DeliberationAI/.local/evidence.pdf
```

Use absolute paths without spaces with the existing Windows wrapper. Preview writes nothing. Both commands hash the evidence locally and require it to match `documentSha256`; evidence bytes are neither uploaded nor stored. The existing 64 KB JSON / 20 MB evidence bounds apply. Original source files and encryption keys still require separate preservation. Hash equality identifies selected bytes, not their authenticity or agreement with the JSON.

Example **synthetic void packet**; replace all ids/digests/dates/reasons with the attribution actually reviewed:

```json
{
  "version": "provider-billing-change-v1",
  "recordId": "00000000-0000-4000-8000-000000000003",
  "expectedFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "documentSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "reviewedAt": "2026-10-01T09:00:00.000Z",
  "reason": "The attribution is not supported by the reviewed source.",
  "action": "void"
}
```

For replacement, set `action` to `replace` and add `replacement` containing a complete `provider-billing-v1` input, following [the original format](PROVIDER_BILLING.md). Its document digest and review time must match the change. The replacement may change billed/review dates, document bytes/digest, component charges/credits and total. It must preserve operation, connection, provider, requested model, provider response, statement id, line id, currency, attribution and scope. Incorrect source/receipt identities can be voided or corrected through the separate explicit DA-087 reallocation.

Use `currentFingerprint` from the inspected current state as `expectedFingerprint`; the retained `fingerprint` continues to identify the original record. Review times must be nonfuture and chronological. Reasons must contain 1–500 trimmed characters. Replacement component totals and credit signs follow the original exact USD arithmetic, with no implicit currency conversion or price recomputation.

## Concurrency, integrity and history

The owned original row lock serializes changes. Two identical concurrent requests return the same change id. Competing requests based on one version allow one new change and reject the other as stale; the owner must inspect the newer state. Replaying an identical older request returns its original change without reapplying it or undoing a newer change.

Each encrypted `provider-billing-change:<id>:payload` retains the complete input; its fingerprint covers normalized input plus sequence, including the previous fingerprint in `expectedFingerprint`. Unique record/sequence and record/request keys enforce ordering/idempotency. Read projections validate authenticated payloads, digests, contiguous sequences, reviewed version links, chronology, identity preservation and replacement arithmetic. Broken or altered chains fail closed. These are application integrity checks; database administrators still have write authority, and this is not an external tamper-proof ledger or proof against removal of an entire trailing history.

There are at most 100 changes per original record. The usage endpoint folds all changes inside its repeatable-read snapshot, returns the latest ten in each attempt's detail view and marks truncated history. The browser shows the original amount/digest, correction reasons and void/replace history. `billing:show` and `billing:list` retain the complete available history and current state. Only the current valid attribution contributes to the subtotal, even beyond the existing 100-attempt detail window. Receipt identity drift remains independently excluded. Voided attempts remain pending, including after unknown/discard outcomes.

Changes are attached to the preserved original billing record, with a restrict-delete FK. Run retention does not erase either attribution or its changes. Current duplicate source/connection-response claims remain reserved, including after void; only explicit DA-087 reallocation transfers them atomically. This same-attribution workflow supplies no accounting deletion, provider refund or monetary-budget operation.

Migration `0037_certain_mysterio.sql` adds `provider_billing_changes` with owner, original-record link, sequence 1–100, request/payload fingerprints, encrypted payload and recording time. It leaves existing attribution ciphertext unchanged. The exhaustive backup inventory includes the new context. Source documents are still outside database backups.

## Remaining gate

This completes the bounded same-attribution correction/void workflow. DA-085/086 preserve explicit unallocated shared charges, and DA-087 adds reviewed identity reallocation. Authentic provider/account/payment reconciliation, real-invoice acceptance, allocation of shared charges to calls and hard input/tool/money reservations remain open. No paid call, real invoice edit/import, real retention apply or JEV activation is used for verification. Local acceptance evidence is recorded in [CURRENT_STATE.md](CURRENT_STATE.md).

## Local acceptance — 1 October 2026

216 offline unit tests, 62 isolated PostgreSQL integration tests, all 12 browser flows, type checking, lint and production build passed. Regression coverage checks concurrent identical/competing edits, stale and foreign requests, mismatched evidence, forbidden source/call remapping, chronological reviews, original ciphertext/amount preservation, void-to-pending and replacement restoration, history after run deletion, a 100-event chain with ten-event usage display, the per-record limit and fail-closed missing events. The browser checks corrected amounts, pending/void coverage, displayed reasons/original evidence, unchanged token estimates and unpriced copied follow-up billing. The intentional corrupt-chain fixture is restored after its rejection check so later read-only list tests remain isolated.

CLI change preview writes nothing, and replace/void record/show were exercised with generated local evidence. Backup `deliberation-20261001T092315Z-402464778636.manifest.json` restored into a temporary database, checked 295 runs / 5,059 encrypted rows / 7,770 decrypted values across eleven populated tables, including two populated new change ciphertexts. Generated billing/change/run/receipt/connection and local evidence/input fixtures were removed afterward. The helper created no queue job or model request. These checks establish local software behavior and restore readability, not provider settlement, source authenticity or replacement-installation recovery/cutover.
