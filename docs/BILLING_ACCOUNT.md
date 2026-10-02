# Account invoice inspection — DA-088

DA-089 adds [local invoice payment/refund evidence inspection](BILLING_PAYMENT.md). It embeds and re-inspects this account packet; actual provider/bank authentication and payment status remain unknown.

DA-088 checks one owner-reviewed invoice across multiple declared connections in a single read-only database snapshot. It binds current saved DA-086 statement heads, catches account-wide duplicate lines/responses and reconciles exact USD totals. It does not authenticate a provider account, fetch invoices or establish payment. The broad settled-cost gate remains open.

## Operator workflow

Review the original invoice and which saved connections belong to that account. Prepare one DA-085 complete-connection statement slice per connection, preserving the invoice's actual unique line ids. Every slice must use the same invoice id and source-document SHA-256. Allocate each source line once. Record each successful slice through [statement history](BILLING_STATEMENT_HISTORY.md), then inspect its current head with `billing:statement:show`.

Prepare a `billing-account-v1` packet. This is a synthetic format example, not an invoice or a current price:

```json
{
  "version": "billing-account-v1",
  "provider": "openai-compatible",
  "accountReference": "reviewed-provider-account-reference",
  "invoiceId": "reviewed-invoice-id",
  "documentSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "reviewedAt": "2026-10-01T12:00:00.000Z",
  "period": { "start": "2026-09-01", "endExclusive": "2026-10-01" },
  "currency": "USD",
  "scope": "complete_declared_connections_invoice",
  "totalUsd": "0.025",
  "connections": [
    {
      "connectionId": "00000000-0000-4000-8000-000000000001",
      "accountMappingReason": "Reviewed the provider account and this connection's invoice slice.",
      "statementVersionId": "00000000-0000-4000-8000-000000000002",
      "expectedFingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ],
  "unallocatedLines": [
    { "lineId": "account-tax", "kind": "tax", "amountUsd": "0.005", "reason": "Shared invoice tax, not assigned to an attempt." }
  ]
}
```

Replace all placeholders. The example assumes a saved connection slice of 0.020 USD plus one account tax of 0.005 USD. `provider` must match the retained billing record's adapter provider value. Different compatible connections may conceal different issuers; the application cannot authenticate that they share an account. `accountReference` and each mapping reason remain owner declarations.

Run:

```powershell
pnpm billing:account:inspect C:/Users/caner/Projects/DeliberationAI/.local/account.json C:/Users/caner/Projects/DeliberationAI/.local/invoice.pdf
```

Use absolute paths without spaces with the Windows root wrapper. JSON is limited to 200 KB and source bytes to 20 MB, with 1–100 connection bindings and up to 1,000 account-level unallocated lines. Source bytes are hashed locally without upload or automatic parsing. Matching hashes identify bytes, not their authenticity or agreement with the reviewed JSON.

Invoice periods are ordered UTC dates with an exclusive end. Current billed dates for attributed attempts must fall inside that interval; reviews cannot predate a selected statement's latest review. Negative statement totals/credits are supported without currency conversion. Unallocated credits must be nonpositive; other unallocated charges must be nonnegative. Component subtotals remain separate from token estimates.

## Results and boundaries

Exit 0 means `reconciled_owner_account_packet`: the declared connections' available local evidence and invoice arithmetic agree. Exit 2 returns an `incomplete` report. Invalid input, source digest, future review or unreadable authenticated history exits 1 with a generic error.

The report includes the reviewed scope/period, account mapping reasons, expected and current statement heads, packet/ledger fingerprints, receipt availability, listed current total, difference, matched-attempt subtotal and unallocated subtotal. Missing or withdrawn slices make the aggregate and difference unavailable, not zero. A genuine known zero stays zero. Duplicate connection/version bindings cannot produce a known aggregate.

A current valid statement is required before its lines contribute to valid component subtotals. The inspector rejects stale heads, changed/unavailable live evidence, wrong invoice/connection identities, different source bytes, earlier reviews, provider/period mismatches, repeated billing records and duplicate source lines or remote response ids across declared connections. Account-level unallocated lines share the same global line-id namespace. Matching arithmetic alone cannot override these issues.

Only current versions contribute; old statement or billing amounts are never summed. Corrections, withdrawals, retention and [identity reallocation](BILLING_REALLOCATION.md) may invalidate previous reviews. Refresh the relevant statement slice and then the account packet; a changed current total is diagnostic evidence, not acceptance of an old reviewed head.

The snapshot separately reports current present receipts and retained records without receipts, rather than copying archived availability counts. These counts use `unit: billing_records`: historical and current roots can share one receipt, so their presence must not be mistaken for extra provider calls or missing evidence. DA-088 corrects the statement inspector's availability count for that same-call reallocation case. A historical inspection with the previous count can become stale and require fresh review. Receipt retention can be explicitly acknowledged through a new successful statement review; it cannot certify payment or restore absent provider evidence.

Every report preserves `accountIdentity: owner_declared`, `providerAuthenticity: unverified`, `paymentStatus: unknown` and `monetaryDispatchAllowed: false`. Scope is the declared connections, not mechanically discovered account completeness. Omitted external lines or undeclared connections cannot be detected. Shared charges stay unallocated and never enter a run's billed subtotal. Aggregate invoices lacking exact response attribution remain outside attempt matching; preserve unsupported charges explicitly rather than infer an allocation from call counts.

The command writes no database data, invokes no provider, changes no dispatch limits and records no durable account ledger. Preserve the packet, original invoice and report separately in protected local storage; they are outside database backups. Existing encrypted statement/billing evidence continues to use its normal backup policy. Account references, mapping reasons and reports may contain sensitive accounting information.

## Verification — 1 October 2026

Seven new domain tests cover exact multi-connection totals/credits, duplicates, missing/withdrawn slices, stale/unreadable evidence, source/provider/review/period drift, genuine zero, invalid signs and strict bounded input. Seven PostgreSQL tests check read-only immutable evidence, owner/source boundaries, correction/re-review, cross-connection duplicates, current receipt retention and withdrawal, same-call reallocation receipt counts, and actual CLI success/incomplete/error/oversize behavior with generated local files.

Verification passed 233 offline unit tests, 88 isolated PostgreSQL tests, type checking, lint and production build. All fixture databases and CLI files were removed. Schema, ciphertext inventory, UI and dispatch are unchanged; browser and backup restore were not repeated. No paid model call, real invoice import, provider-account authentication, payment acceptance or JEV activation occurred.

DA-088 completes this local technical account inspection step. Provider-authoritative invoice/account/payment evidence and real-account acceptance remain open, followed by conservative hard input/tool/money reservations. Conversation continuation remains a separate task group.
