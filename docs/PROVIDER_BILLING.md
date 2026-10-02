# DA-083 — owner-reviewed billing evidence

DA-084 now adds [append-only same-attribution correction/void history](BILLING_CORRECTIONS.md). The original is still immutable; current state and full history are available through the existing operator inspection commands.

DA-087 adds [explicit reviewed identity reallocation](BILLING_REALLOCATION.md). Current claims prevent duplicate attribution while original roots remain immutable; a move appends a new root/event and preserves direct provenance on both sides.

This increment records immutable, owner-reviewed billing evidence for an exact provider attempt. It retains the source document's SHA-256, statement/line identifiers, declared components and total, review date and a fingerprint of the matched receipt. The usage panel shows a separate **recorded billing subtotal**, pending attempts and receipt mismatches. It never adds this amount to DA-082's token estimate.

The record status is `owner_recorded`, not automatically provider-verified, paid or settled. No real invoice was supplied or imported during implementation. Technical acceptance uses synthetic evidence; real-account reconciliation and the broad settled-cost/monetary gate remain open.

## Operator workflow

Prepare a JSON attribution packet after reviewing the original provider document. Keep that document separately. Use absolute paths without spaces with the existing Windows command wrapper:

```powershell
pnpm billing:preview C:/Users/caner/Projects/DeliberationAI/.local/billing.json C:/Users/caner/Projects/DeliberationAI/.local/provider-statement.pdf
pnpm billing:record C:/Users/caner/Projects/DeliberationAI/.local/billing.json C:/Users/caner/Projects/DeliberationAI/.local/provider-statement.pdf
pnpm billing:list
pnpm billing:show 00000000-0000-4000-8000-000000000003
```

Preview checks the packet, file digest, exact owned receipt/frozen member identity, dates, amount reconciliation and current identity-claim conflicts without writing. Record rechecks under the run/attempt locks and atomically inserts the root and its claims. Listing returns the newest 100 owned roots, including historical superseded ones; `billing:show` retrieves an older or retained record by its id. Source evidence is limited to 20 MB, JSON to 64 KB. The file is hashed locally and is neither uploaded nor parsed automatically; the owner must confirm what the file actually says. The document digest proves which bytes were selected, not that their assertions are authentic or that the JSON matches their contents.

The following is a **synthetic format example**, not an invoice or a current price:

```json
{
  "version": "provider-billing-v1",
  "operationId": "00000000-0000-4000-8000-000000000001",
  "connectionId": "00000000-0000-4000-8000-000000000002",
  "provider": "openai-compatible",
  "model": "exact-requested-model",
  "remoteResponseId": "exact-provider-response-id",
  "statementId": "provider-statement-reference",
  "lineId": "exact-attributable-line",
  "documentSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "billedAt": "2026-10-01T00:00:00.000Z",
  "reviewedAt": "2026-10-01T01:00:00.000Z",
  "attribution": "exact_remote_response",
  "scope": "all_charges_for_this_attempt",
  "currency": "USD",
  "totalUsd": "0.010",
  "components": [
    { "kind": "tokens", "amountUsd": "0.001" },
    { "kind": "tools", "amountUsd": "0.010" },
    { "kind": "credit", "amountUsd": "-0.001" }
  ]
}
```

Replace all placeholders, including the document digest and the actual reviewed scope. Valid component kinds are tokens, tools, cache_write, storage, modality, tax, credit and other. There may be 1–32 components. Amounts are decimal strings up to 999999999.999999999999 USD; totals are nonnegative, credits nonpositive and other components nonnegative. Integer pico-USD arithmetic requires components to sum exactly to the declared total. Genuine zero is supported. There is no currency conversion or inferred charge from token rates.

`all_charges_for_this_attempt` is an explicit owner attestation of complete attribution for that attempt. It does not assert that every invoice/account charge has been imported. Do not divide an aggregate invoice by call/token counts or assign shared storage/taxes without exact supporting evidence. Evidence with only account/workspace/day totals remains unallocated; this interface does not pretend to solve allocation. Non-USD, aggregate-only, partial-attribution and missing remote-id evidence cannot be imported through this contract.

## Integrity, uncertainty and retention

The attempt must be owned, have a recorded submission timestamp and a closed/unknown outcome, and match provider, requested model, provider response id and frozen member connection. A deleted or edited live connection does not rewrite this frozen history. Legacy attempts lacking a recorded submission timestamp remain pending and cannot be retroactively certified by guessing.

Records are encrypted under `provider-billing:<id>:payload`. SHA-256 binds the normalized packet, receipt identity and original run id; separate fingerprints protect source line and connection/response identity. DA-087 current claims hold unique owner/attempt, owner/source-line and owner/connection-response keys to prevent duplicate charges, including concurrent records. Unique owner/root-payload fingerprints preserve immutable input idempotency. Identical input is idempotent; changed input cannot overwrite a root. DA-084 supplies same-attribution replacements/voids, and DA-087 creates explicit linked new roots when identities must change. Exact old retries never reactivate a superseded attribution. Review the preview before recording a real attribution. Connection ids are application identities, not an independently verified common provider-account identity across duplicate connections.

Read projections compare the retained receipt fingerprint with current attempt identity. A changed receipt becomes `receipt_mismatch` and is excluded from the subtotal while the original evidence remains intact. Changed token counters do not rewrite a documented billed amount. Unknown/discard status alone neither erases evidence nor certifies an unrecorded amount. Missing submitted/legacy billing stays pending, not zero; explicitly known unsubmitted attempts are not counted as billed. Corrupt authenticated payloads/digests fail closed.

The existing owner-scoped, uncached usage endpoint aggregates all attempts in bounded pages within one repeatable-read transaction. It displays only the latest 100 attempt details, while the subtotal and pending/mismatched counts cover every attempt. It exposes billing metadata/components without credentials, prompts or model output. Even with no pending attempts, the subtotal is not an account invoice total, payment confirmation or monetary cap.

Migration `0035_zippy_lester.sql` creates `provider_billing_records`; `0036_sad_sinister_six.sql` adds the original remote-identity uniqueness guard. DA-087 migration `0039` moves identity uniqueness into backfilled current claims and adds linked move events. Apply normal migrations before starting the updated application. Run/connection ids are logical provenance references without cascade FKs: run retention preserves billing records, which remain accessible through `billing:list`/`billing:show`. Billing deletion policy remains open; this workflow deletes no real owner evidence.

The exhaustive backup inventory includes this new ciphertext column. Backups retain the encrypted attribution and digest, **not the source document bytes**. Preserve the original evidence and encryption key separately to review restored provenance.

## Provider reporting boundary and next work

Official references inspected on 1 October 2026: [Claude Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) describes organization-admin access and bucket/group-based reporting; [Gemini billing](https://ai.google.dev/gemini-api/docs/billing) describes billing/usage visibility. This implementation does not call those account endpoints or assume their aggregate rows contain an exact request-level settlement. Manual exact attribution is a bounded local foundation, not a substitute for a provider-authoritative import.

DA-085/086 now inspect and preserve explicit unallocated shared charges; DA-087 handles reviewed local identity reallocation. Remaining work includes authentic provider/account evidence and real-account acceptance, authoritative completeness and invoice/payment reconciliation, shared-charge allocation to calls and conservative input/tool/money reservations. No paid provider request, real invoice import or JEV activation is part of this workflow.

## Local verification — 1 October 2026

214 offline unit tests, 58 isolated PostgreSQL tests, all 12 browser flows, type checking, lint and production build passed. Tests cover exact decimal arithmetic with credits/tools, zero values, owner/document/receipt guards, concurrent idempotency, duplicate source/response rejection, immutable records, identity drift, unknown/discard behavior, retained records after run deletion, tamper detection and all-attempt totals past the 100-row detail window. The browser uses a local mock and confirms separate token/recorded-billing subtotals, pending coverage, preserved token estimates and no inherited child billing.

The operator preview/record/show commands were exercised with generated synthetic document bytes and a generated cancelled run/receipt/connection, without a queue job or network model request. Backup `deliberation-20261001T090510Z-1720361db3c1.manifest.json` restored into a temporary database, checked 295 runs, 5,057 encrypted rows and 7,768 decrypted values, including a populated billing ciphertext field. The generated billing/run/receipt/connection and local evidence/input fixtures were removed afterward. These counts describe the backup snapshot, not a final live inventory or replacement-installation cutover. Verification establishes local mechanics, not real provider billing accuracy.
