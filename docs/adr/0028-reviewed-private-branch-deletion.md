# ADR-0028: reviewed private branch content deletion with retained audit

Status: accepted for bounded local DA-101, 2 October 2026.

Private branches retain independent copied seed/messages and provider receipts after
source retention. Deleting a parent blindly would conceal surviving copies, pending
work or metered usage; replaying an old creation intent could recreate removed content.

Require read-only preview, explicit content/retained-metadata confirmation and an exact
target fingerprint. Remove one owned leaf branch row only after authenticated copy,
pending receipt, worker lease, ownership, schema and bounded-capacity checks. Serialize
with existing owner/worker locks without waiting on the worker lease after owner lock.
Recheck and atomically replace content with encrypted content-free audit; any failure
preserves the target. No provider request, cancellation or automatic repeat is added.

Retain terminal usage/provenance plus original creation request ID, excluding seed,
messages and request/result/error text. Logical identifiers have no cascading FKs, so
audit survives later empty identity deletion. Replay of confirmed deletion returns the
same audit; deleted create/fork request IDs cannot resurrect the branch. Preserve copied
receipt origins without counting fresh calls or implying a refund/budget.

Consequences: copied leaves need individual review; unknown/in-flight work and unsupported
schemas block removal. Encrypted audit is exported/backed up and remains bounded but
not automatically pruned. Unsaved text stays ephemeral and external archives retain
content. Partial message/cascade/account/forensic erasure and reviewed run-body deletion
are separate work. [Contract](../PRIVATE_BRANCH_DELETION.md),
[acceptance](../DA101_ACCEPTANCE.md).
