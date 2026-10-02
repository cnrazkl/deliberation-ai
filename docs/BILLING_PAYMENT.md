# Invoice payment evidence inspection — DA-089

DA-089 compares a current [DA-088 account invoice packet](BILLING_ACCOUNT.md) with declared exact-invoice payment/refund evidence. It makes no provider/bank API request, initiates no payment or refund and writes no database records. Matching local evidence amounts does not authenticate a provider account, bank transaction or settled invoice.

## Operator workflow

Review the original invoice, current connection statement heads and exact allocation of each payment/refund to that invoice. First prepare a complete `billing-account-v1` packet with current reviewed statement ids/fingerprints. Then place that complete object under `account` in a strict `billing-payment-v1` packet.

This is a synthetic envelope example. The empty account object is a placeholder: replace it with the complete DA-088 packet and replace all ids/digests/references/dates with reviewed evidence.

```json
{
  "version": "billing-payment-v1",
  "account": {},
  "reviewedAt": "2026-10-01T12:00:00.000Z",
  "reason": "Reviewed exact invoice payment evidence.",
  "scope": "complete_declared_invoice_payment_evidence",
  "entries": [
    {
      "entryId": "payment-1",
      "transactionReference": "exact-payment-transaction-reference",
      "invoiceId": "the-account-packet-invoice-id",
      "accountReference": "the-account-packet-account-reference",
      "kind": "payment",
      "amountUsd": "0.020",
      "currency": "USD",
      "allocation": "exact_invoice",
      "occurredAt": "2026-10-01T11:00:00.000Z",
      "sourceKind": "provider_receipt",
      "documentSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "sourceLineId": "exact-payment-source-line",
      "attributionReason": "The reviewed source identifies this invoice and the complete payment amount."
    }
  ]
}
```

Entry amounts are positive fixed-point USD strings with at most nine integer/twelve fractional digits. `payment` adds to the net evidence total; `refund` subtracts. A refund needs its own distinct transaction reference and source line. Source kinds are `provider_receipt` or `bank_statement`. There is no currency conversion, token-price estimate or inferred allocation. Account top-ups, pooled payments or amounts not supported as exact invoice allocation need external review; this contract cannot allocate them automatically.

Every entry repeats the account packet's exact invoice/account references. The owner explains the allocation in 1–500 characters. Both documents and packet fields require review; the command hashes selected bytes without extracting or verifying their assertions. Source hashes can be computed locally before preparing the packet. Two evidence documents describing one transaction must become one entry, not two additive payments. Use a consistent transaction reference; provider/bank references that cannot be linked remain an external-review limitation.

Prepare a separate evidence manifest:

```json
{
  "version": "billing-payment-evidence-v1",
  "files": [
    {
      "entryId": "payment-1",
      "path": "C:/Users/caner/Projects/DeliberationAI/.local/payment-receipt.pdf"
    }
  ]
}
```

Each manifest id must name a declared entry exactly once. Multiple distinct entries may select different lines from the same file; its bytes are hashed once. Omitting a declared entry's file produces an incomplete report, never an inferred zero payment. Extra/duplicate manifest ids and relative paths are rejected before referenced sources are read.

Run:

```powershell
pnpm billing:payment:inspect C:/Users/caner/Projects/DeliberationAI/.local/payment.json C:/Users/caner/Projects/DeliberationAI/.local/invoice.pdf C:/Users/caner/Projects/DeliberationAI/.local/payment-evidence.json
```

All paths must be absolute; use paths without spaces for the root Windows wrapper's three arguments. Manifest file paths can contain spaces because they are read directly. Payment JSON is limited to 250 KB, manifest JSON to 200 KB, entries/files to 100, each source file/invoice to 20 MB and distinct payment-source paths to 100 MB collectively. Metadata limits are checked before source hashing, and streams enforce limits again while reading. Source paths are not included in the report.

## Currentness, arithmetic and results

The embedded account packet is re-inspected against full owned statement history and live billing evidence in one repeatable-read read-only snapshot. Pure payment arithmetic uses that returned snapshot; it makes no further database queries. Parent review must be no earlier than the embedded account review, and cannot be future dated. Payment/refund occurrence must be no later than the parent review. Payment may legitimately follow the invoice period; its date is not forced into the usage period.

The inspector rejects repeated entry ids, transaction references and source-document/line pairs, wrong account/invoice allocation, later occurrence dates, missing/mismatched selected bytes and incomplete or mismatched account inspection. A changed billing amount, statement head, retention state, withdrawal or reallocation requires fresh invoice and payment review. Apparently balanced old payments cannot override a stale invoice.

The report separates:

- `listedNetPaymentUsd`: all declared entries, including invalid/duplicate lines, for diagnosis.
- `supportedNetPaymentUsd`: the subtotal of locally digest-matched, unique and identity/date-consistent entries. This is payment evidence only; it cannot certify the invoice.
- `differenceUsd`: reviewed invoice total minus supported net evidence, available only when the invoice and every entry pass their local checks.

An invalid/absent source can yield an unavailable supported subtotal; missing evidence never becomes a zero payment. A partial supported subtotal is diagnostic, with unavailable difference and incomplete status. A known zero invoice with an explicitly empty evidence packet may balance locally; a nonzero invoice with no entries remains incomplete. Negative credit invoices can match net refunds. These are exact local arithmetic observations, not provider payment-status assertions.

Exit 0 returns `reconciled_owner_payment_packet`; exit 2 returns `incomplete` with issues. Exit 1 uses a generic error for invalid input, file/path/size/evidence-manifest rules, future review or unreadable authenticated history. Successful reports include the embedded account inspection, source match statuses, declared provenance/reasons and packet/account/ledger/evidence fingerprints with separate account/payment inspection timestamps.

Every report preserves `accountIdentity: owner_declared`, `providerAuthenticity: unverified`, `paymentEvidenceAuthenticity: unverified`, `paymentStatus: unknown` and `monetaryDispatchAllowed: false`. The owner-declared completeness scope cannot discover omitted external transactions or authenticate a common account. Cross-packet payment uniqueness is not a durable reservation. This command records no account/payment ledger, changes no run subtotal or dispatch allowance and performs no financial action.

Keep packets, manifests, invoices, receipts, bank documents and reports in protected local storage. They may contain sensitive accounting information and remain outside database backups. Existing encrypted billing/statement history continues to use its normal backup policy.

## Verification — 1 October 2026

Seven new domain tests cover exact payment/refund amounts, occurrence after invoice period, missing/mismatched sources, duplicate identities, wrong allocation/chronology, stale or mismatched accounts, credit/zero invoices and strict bounded intake. Seven PostgreSQL tests cover immutable read-only evidence, intake/source boundaries, correction/re-review, duplicate/wrong allocation, foreign/withdrawn/unreadable history, actual CLI digest changes and success/incomplete/error exits, and bounded sources/manifests including cumulative 100 MB rejection.

Verification passed 240 offline unit tests, 95 isolated PostgreSQL tests, type checking, lint and production build. Generated fixtures, source files and disposable databases were removed. Schema, ciphertext inventory, UI and dispatch are unchanged; browser and backup restore were not repeated. No paid model call, real invoice/payment import, provider/bank authentication, payment/refund action or JEV activation occurred.

DA-089 completes this local technical payment-evidence inspection. Provider-authoritative invoice/account/payment evidence, real-account acceptance and hard input/tool/money reservations remain open. Conversation continuation remains a separate task group.
