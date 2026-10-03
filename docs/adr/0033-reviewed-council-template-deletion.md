# ADR-0033: Reviewed saved council-template deletion

Status: accepted, 3 October 2026.

Physical deletion plus name matching permitted stale creation replay and provided no reviewed state. Retain the existing row as a scrubbed tombstone with durable owner/request identity and original hash. Active-name uniqueness permits intentional reuse by a fresh identity. Exact-state, bounded preview and explicit acknowledgement precede an atomic encrypted receipt/content scrub under owner/table serialization. Lost confirmations return the same receipt. Legacy rows retain nullable creation identities; they are not reconstructed.

Independent frozen run/schedule configurations and external copies remain. Fail closed on schema/dependency drift; register every new encrypted field and validate a populated custom archive restore. This retains replay metadata indefinitely and requires future coordinated retention policy rather than silently dropping intent history. [Contract](../COUNCIL_TEMPLATE_LIFECYCLE.md).
