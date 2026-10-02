# ADR-0021: Frozen report context for a new question

Accepted locally: 1 October 2026, DA-090.

Saved history and selected-member reruns cannot express a new question with reviewed historical context. Reloading a mutable source at dispatch would invalidate the preview and tie descendants to ancestor retention.

The owner explicitly selects and reviews a full bounded question/report copy. Preview and enqueue resolve only owned sources and bind a digest; enqueue locks and rechecks the source before encrypting the snapshot on the child. Every independent initial member and later review receives this untrusted input. Source results/receipts are not reused and historical consensus/evidence labels gain no authority. Historical text enters risk checks, and the source high-risk floor cannot be lowered.

The child survives source deletion because dispatch and export use its own snapshot. Copied information lasts until the child's own retention. Oversize history is rejected rather than silently summarized. No-history requests retain existing rendering/fingerprints. There is no provider-managed conversation id.

Compaction, conversation aggregates, branch navigation and sibling-aware export remain separate work. Scheduling history is unavailable. [Workflow and boundaries](../CONVERSATION_CONTINUATION.md).
