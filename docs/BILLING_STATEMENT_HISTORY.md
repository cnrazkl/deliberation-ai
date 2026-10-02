# Durable owner-reviewed statement history — DA-086

DA-088 adds [read-only account invoice inspection](BILLING_ACCOUNT.md) across current reviewed connection slices. It binds existing head ids/fingerprints without writing account history or certifying payment.

DA-086 saves the complete DA-085 packet and its successful local inspection as an encrypted immutable version. A later version can correct the same statement or withdraw its evidence without overwriting older packets, shared-charge lines, amounts, reasons or document digests. This is owner-reviewed local accounting provenance: provider authenticity remains unverified, payment unknown and monetary dispatch unauthorized.

## Operator workflow

Use `pnpm billing:statement:inspect <absolute-packet-json> <absolute-evidence>` first. Prepare a `billing-statement-change-v1` JSON containing `action: record`, `connectionId`, `statementId`, `documentSha256`, ISO `reviewedAt`, a review `reason`, `expectedFingerprint` and the complete `packet` from [DA-085](BILLING_STATEMENTS.md). The packet must repeat the same connection/statement, evidence digest and review date.

Set `expectedFingerprint: null` for the first version. For later versions, copy the current `head.fingerprint` from `billing:statement:show`; an older reviewed fingerprint is rejected. The packet's attempt lines must separately bind the current billing attribution fingerprints.

- `pnpm billing:statement:preview <absolute-change-json> <absolute-evidence>` validates without writing.
- `pnpm billing:statement:record` with those arguments appends one immutable version.
- `pnpm billing:statement:list` lists the latest 100 statement heads, with `freshness: not_checked` and no combined spending total.
- `pnpm billing:statement:show <version-id>` opens the complete current history for that statement, even when the supplied id is an older version, and recomputes live ledger freshness.

Use paths without spaces with the Windows root wrapper. Change JSON is limited to 1.1 MB, source bytes to 20 MB, packets to 1,000 lines and each statement to 100 versions. Only locally reconciled packets can be recorded. Inspection failures/incomplete packets require review before recording; the read-only inspector remains available to diagnose them. CLI failures use a generic message and exit 1; success exits 0.

For withdrawal, use `action: void` with the same common identity, digest, review date, reason and current expected fingerprint; omit `packet`. Withdrawal needs an existing owned statement. It clears the effective local statement projection, not provider charges or payment obligations. A fresh `record` version can restore evidence. All previous versions remain available; a void never produces an inferred zero-spend statement.

## Concurrency and currentness

A connection/statement identity has one ordered chain. Transaction advisory locks plus unique owner/identity/sequence and request fingerprints prevent branching or duplicate appends. A repeatable-read snapshot covers the complete relevant billing ledger and the insertion. If waiting for a lock leaves an older snapshot, a database sequence/serialization conflict retries the whole transaction, at most three attempts; there is no partial append or provider request. Conflicting owner revisions are rejected as stale.

An exact retry returns the original version, including after newer corrections/withdrawal. It does not move the head or reapply old evidence. Previewing such a retry returns the archived inspection; use `show` to assess present freshness.

`show` preserves the archived inspection and separately returns a live inspection:

- `current`: local ledger fingerprints, successful coverage and receipt availability still agree with the recorded snapshot.
- `ledger_changed`: corrections, new known attributions, identity drift or receipt retention changed the local evidence; the archived amount remains historical.
- `inspection_unavailable`: the live ledger cannot be validated; historical bytes remain visible, but freshness is denied.
- `voided`: the latest version withdrew the effective statement.

These statuses are local observations. Missing unrecorded external lines, provider-account ownership and source authenticity still require external review. A connection/statement pair is not an authoritative provider-account key. Source documents spanning multiple connections are not automatically merged. The command neither allocates shared charges to runs nor changes run subtotals, source/call attribution identities or dispatch limits.

## Storage and retention

Migration `0038_wise_mandarin.sql` adds `billing_statement_versions`: id, owner id, hashed connection/statement identity, sequence, request/payload fingerprints, encrypted payload and recording time. Logical identity has no run/connection FK. Full version history survives their deletion. Withdrawal can still be recorded against owned history; a new successful inspection requires available owned connection or historical billing evidence. Retained records without receipts are explicitly counted. A new owner review can acknowledge that local limitation without certifying provider authenticity.

`billing-statement-version:<id>:payload` authenticates the encrypted change and inspection. Hydration checks schema, identity/request/payload fingerprints and packet binding; the domain checks contiguous versions, reviewed heads, chronology and archived exact arithmetic. Altered/gapped chains fail closed. This is an application append-only policy: database administrators retain write authority, and a complete trailing-history removal has no independent external anchor.

Saved packets and inspection snapshots now participate in database backups, including shared-charge details and correction reasons. Original source bytes, intake JSON, separate report exports and the encryption key still require protected separate preservation. Operator output includes sensitive accounting information and belongs in protected local storage.

## Acceptance evidence

Three new domain tests cover correction/withdrawal/restoration, preserved original amounts, chain/version/identity/chronology guards, archived arithmetic and bounded strict intake. Eight PostgreSQL tests cover preview no-writes, four concurrent duplicate first appends, competing revisions, original ciphertext stability, old-request replay, stale/unreadable live evidence, retention, full 100-version history, integrity/gap/limit rejection and actual CLI preview/record/list/show.

Verification passed 224 unit tests, 73 isolated PostgreSQL tests, type checking, lint and production build. Browser and provider dispatch behavior are unchanged; browser tests were not repeated. Migration `0038` is applied locally. A fresh archive `deliberation-20261001T103314Z-093b827a1628.manifest.json` restored into a disposable database and checked 300 runs, 5,145 encrypted rows and 7,919 decrypted values, including three generated statement versions (record, replacement and withdrawal). Generated statement/billing/run/receipt/connection/source fixtures were removed. No jobs, paid model calls, real invoice import or payment acceptance were performed.

DA-087 adds [explicit reviewed identity reallocation](BILLING_REALLOCATION.md). A move invalidates affected saved inspections without rewriting their historical amounts; a fresh packet must bind the new root/current version. Remaining settled-cost work: authoritative provider/account/invoice/payment reconciliation and real-account acceptance, followed by conservative hard input/tool/money reservations. Conversation continuation/compaction/branches/export remain a separate open group.
