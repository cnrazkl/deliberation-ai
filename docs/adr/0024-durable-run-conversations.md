# ADR-0024: Durable run conversations and retained-membership export

Accepted locally: 1 October 2026, DA-093.

Immediate run links provide navigation but lose the ability to discover all related branches when an intermediate body is pruned. A single-run export also misses siblings. Group runs under a durable owned conversation, preserving minimal membership metadata after body retention.

New root/child membership is atomic with run enqueue and serialized before source-row locking. Legacy grouping authenticates surviving links and labels its reconstruction limits. Never invent deleted reports or silently merge established groups. Keep content in existing encrypted run snapshots; membership stores only IDs, kind and creation time.

Export all recorded members in one read-only database snapshot, explicitly marking unavailable bodies and running/null-report state. Reuse the existing hydrated report and validated continuation/archive projections, with explicit safe output fields. Reject oversized or inconsistent snapshots without partial output. Preserve separate attachment/evidence/provider accounting boundaries.

The contract is bounded to run-based conversations. A separate conversation library, model-private messages, branch editing and deletion-policy expansion remain separate decisions. [Contract](../CONVERSATIONS.md).
