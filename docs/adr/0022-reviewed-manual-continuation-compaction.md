# ADR-0022: Manual compaction with a private original archive

Accepted locally: 1 October 2026, DA-091.

Full source continuation can exceed the delivery limit. Silently truncating historical raw/minority text would hide omissions; sending an unreviewed generated summary would imply fidelity we have not measured. Keeping only a source pointer would also lose original inspection after ancestor retention.

The owner writes and explicitly reviews a summary. The server binds original sections, omission digests and source provenance, preserves the source question, and scans original history for required risk controls. Summary edits clear UI review; source or prompt drift rejects enqueue. The new delivered `run-continuation-v2` context identifies missing detail and the owner's summary without claiming equivalence or verified truth.

A separate authenticated encrypted archive retains original text, reviewed selection and delivered digest. It survives source deletion and is excluded from provider work. Full-context descendants and member reruns inherit the original privately; omitted text is never implicitly reintroduced. Later compaction preserves earlier archives within a 2 MiB original-text cap. Validation binds the archive to the delivered summary or a bounded delivered ancestor.

This adds manual compaction, not automatic semantic summarization, branch management or a conversation aggregate. Plaintext JSON export deliberately includes delivery and archive with that distinction. [Workflow and limits](../CONVERSATION_COMPACTION.md).
