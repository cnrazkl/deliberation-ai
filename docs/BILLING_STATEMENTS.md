# Owner-reviewed statement inspection — DA-085

DA-088 adds [account invoice inspection](BILLING_ACCOUNT.md) across declared connections using current saved statement heads. Preserve invoice-wide unique source line ids and the same invoice id/document digest in each connection slice.

DA-086 adds optional [durable encrypted statement history](BILLING_STATEMENT_HISTORY.md), correction/withdrawal and currentness checks. The inspection command below remains read-only; saved packets/inspection snapshots now join backups only when recorded through that separate workflow.

`pnpm billing:statement:inspect <absolute-json-path> <absolute-evidence-path>` compares an owner-reviewed USD statement packet with one local ledger snapshot. It writes nothing and makes no network request. On Windows, use paths without spaces with the root wrapper.

The strict `billing-statement-v1` packet requires `connectionId`, `statementId`, `documentSha256`, a nonfuture ISO `reviewedAt`, `currency: USD`, `scope: complete_connection_statement`, `totalUsd` and 1–1,000 `lines`. JSON is limited to 1 MB and evidence to 20 MB. The CLI checks the selected source bytes' SHA-256, not their contents or authenticity. The connection must be currently owned or have owned historical billing records for this statement.

Every line contains `lineId` and `amountUsd`. An `allocation: attempt` line also requires the owned `recordId` and its reviewed `expectedFingerprint` from `billing:show`. An `allocation: unallocated` line requires a reason and a kind: `tools`, `cache_write`, `storage`, `modality`, `tax`, `credit` or `other`. For example, one attempt of 0.02 USD and a shared tax of 0.005 USD give a declared total of 0.025 USD. Preserve the tax as unallocated rather than distribute it among calls.

Amounts are exact decimal strings with at most nine integer and twelve fractional digits. Scientific notation is rejected. Only unallocated credits may be negative, and credits cannot be positive. Statement totals may be negative when credits exceed charges. A genuine zero is allowed; an unavailable record never becomes a zero subtotal.

## Results

The report separately shows the declared total, all listed lines, their residual, valid matched-attempt subtotal and declared unallocated subtotal. It flags duplicate lines/records, absent or foreign references, wrong connection/statement/line identities, stale fingerprints, voided or reallocated records, mismatched amounts/receipts and reviews older than the effective attribution. All known owned records in the statement must be linked, including voided records; DA-087 superseded roots are excluded from effective coverage and cannot be referenced as attempt lines. Switching a current recorded line to unallocated cannot hide that history. [Explicit reallocation](BILLING_REALLOCATION.md) creates a new root which needs a fresh reviewed packet.

All owned roots are scanned in stable pages rather than the latest-100 window. Encrypted payload integrity and relevant correction chains are checked inside one repeatable-read, read-only transaction. Retention may remove receipts; historical records survive and `receiptChecks.retainedWithoutReceipt` reports that limitation. A present receipt whose identity changed invalidates its match and excludes its amount. Invalid relevant correction history aborts inspection.

Exit status 0 means `reconciled_owner_packet`: the selected packet balances against the available local ledger. Exit status 2 emits an `incomplete` report with issues. Status 1 denotes invalid input/evidence/history and emits only a generic error. Every report preserves `providerAuthenticity: unverified`, `paymentStatus: unknown`, `monetaryDispatchAllowed: false`, packet/ledger fingerprints, evidence digest and inspection time.

The connection/statement pair is a declared scope, not an authoritative provider-account identity. An omitted external line with no local record cannot be discovered mechanically; review the complete original document. Invoices spanning multiple saved connections need separate authoritative reconciliation. Matching hashes bind selected bytes and local versions, not external truth or payment. Subsequent ledger changes require fresh inspection.

Packets, source files and redirected reports contain sensitive accounting data. Keep them in protected local storage; they are outside database backups. No database table or ciphertext was added. The command cannot edit run subtotals or authorize monetary dispatch.

## Verification and remaining work

Five domain tests exercise exact credits/residuals, duplicate exclusion, invalid references/versions, omitted known records and strict bounded intake. PostgreSQL tests verify no writes, owner/evidence boundaries, correction/receipt drift, retained history, 101-row coverage and omission detection. Actual CLI subprocesses check success/incomplete/error exit codes using synthetic bytes; temporary files are removed. Full verification: 221 unit tests, 65 isolated PostgreSQL tests, type checking, lint and production build. Browser behavior is unchanged; no paid generation or real invoice acceptance occurred.

DA-086 supplies local persistent statement/shared-charge history, and DA-087 supplies reviewed local identity reallocation. Provider-authoritative invoice/account reconciliation, real payment acceptance and hard input/tool/money reservations remain open.
