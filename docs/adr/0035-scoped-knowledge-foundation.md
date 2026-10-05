# ADR-0035: scoped knowledge foundation

Accepted for the DA-120 backend increment, 5 October 2026.

Use owned local collections, initially revoked revisioned grants and encrypted
conversation selections backed by many-to-many rows. Exact selection UUIDs/grant
revisions fence stale access. Authorization is checked before and after adapter reads.
Current topic/selection exports remain inspectable after revocation.

The application owns the normalized read-only port, policy gateway and offline fake.
DA-121 owns source storage/extraction; DA-122 owns frozen packets/budgets/dispatch.
Empty-conversation deletion blocks retained selections and preserves schema drift
protections. Backup auditing authenticates the complete schema era and relationships.

The owner authorized this next technical task with DA-119 human gold still open;
that authorization does not establish model-quality acceptance.
[Contract](../KNOWLEDGE_SCOPE.md), [verification](../DA120_ACCEPTANCE.md).
