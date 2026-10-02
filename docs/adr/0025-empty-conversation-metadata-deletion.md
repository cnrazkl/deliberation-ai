# ADR-0025: reviewed deletion of empty conversation metadata

Date: 2 October 2026
Status: Accepted for the local owner boundary

DA-093 retains conversation identity and membership after run-body retention, while DA-094 makes those metadata-only records discoverable. The owner needs an explicit way to remove an obsolete record without extending run-retention deletion or erasing surviving branch provenance.

Use a narrow versioned policy: only one owned conversation with no retained body and no retained incoming reference can be deleted after snapshot review. Keep metadata by default. Require complete owner grouping and reject ownership drift, oversized membership and unreviewed schema/dependencies/triggers. Bind every selected membership and exact timestamp in the reviewed fingerprint; recheck under the existing owner lock plus table locks, then remove only the two metadata-table records in one transaction.

Preview/cancel never mutate or generate. Deletion has a separate explicit confirmation and rejects changed/ineligible state. SQL/lock time limits prevent indefinite blocking. Existing backups and exports remain independent copies; restore can resurrect metadata. No erasure-across-all-copies claim is made.

This policy does not delete available runs or future model-private messages/branches. Those need a new explicit policy rather than an expanded cascade. [Contract and acceptance](../CONVERSATION_DELETION.md).
