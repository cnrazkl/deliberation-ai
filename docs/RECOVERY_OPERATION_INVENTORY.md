# Restored operation inventory

`pnpm db:backup:rehearse` verifies a saved archive in a generated temporary
database, then prints counts from that archive. It never starts a worker, calls a
provider, resumes jobs, changes schedules or replaces the owner's database.

The existing run, council provider-operation and active-schedule counts now have
separate decision-assessment, decision-operation and private-delivery inventories.
Decision metadata is grouped by known status. This inspection does not enable the
excluded TypeSafe/JEV adapter or authorize a retry.

Private branch bodies are authenticated and validated with the existing bounded
decoder. The scanner checks ciphertext sizes before loading them and reads at most
16 branches per UUID page. Only aggregate counts leave the scanner; prompts,
responses, credentials, branch IDs and error details are not printed.

`ownDeliveryStatuses` counts deliveries whose origin is the inspected branch.
`copiedDeliveryStatuses` counts inherited historical snapshots separately: a fork
does not add another dispatch, and its copied status can differ from the origin's
later outcome. Copied statuses remain visible even if the original branch has
been removed. They must not be summed with origin counts as unique attempts or
treated as current provider outcomes. An absent optional deliveries array is an
empty draft history, not a fabricated provider receipt.

These private counts cover retained branch bodies, not deleted-branch receipts or
a complete billing history. The existing exhaustive encryption audit still checks
retained deletion receipts. Historical missing feature tables produce `null`,
distinct from an available empty inventory. A partial decision schema, unknown
decision status, unreadable private body or oversized ciphertext refuses
verification with a fixed error.

Before a real replacement cutover, review queued/running runs and decision
assessments, prepared/submitted/outcome_unknown/retry_authorized operations, copied private outcomes
and active schedules. Counts are a snapshot of the saved archive, not live state,
proof of a remote outcome or permission to resend. Use the relevant existing
review/recovery controls; an unknown operation may already have incurred cost.
Queue job states now have a separate [read-only inventory](RECOVERY_QUEUE_INVENTORY.md).
Actual cutover, current-versus-archive change reconciliation, queue-target reconciliation,
old-binary compatibility and external backup/export deletion remain open.

## Verification

Three offline cases cover origin/copy separation, unavailable historical schemas,
incomplete schemas and fixed error redaction. A disposable PostgreSQL case scans
18 authenticated branches across pages, retains copied unknown outcomes, proves
inspection leaves ciphertext unchanged, and rejects wrong encryption context and
oversized records. It also checks unavailable/partial feature schemas. The existing
decision fixture checks real succeeded and unknown operation/assessment counts
without invoking the disabled adapter. The native private receipt fixture checks
identical inventories after actual custom-format dump/restore, including exclusion
of a deleted branch's retained receipt. Normal CI includes the offline cases.
