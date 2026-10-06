# ADR-0039: Atomic local evidence save and explicit manual handoff

Accepted 6 October 2026 for DA-124.

Use existing local source versions for exact approved passages and a separate encrypted
immutable publication receipt for the reviewed original and destination. Atomic local
transactions avoid pretending a database commit and remote upload are atomic. Request
identity and destination/original deduplication protect lost acknowledgements.

Only verified/current candidates with an accessible unchanged original can be saved.
The separate payload/destination review cannot promote claims or select council inputs.
No external adapter has passed admission; manual packets remain pending until owner
declaration, with remote verification and indexing explicitly unknown. Source and
receipt copies block run-body erasure until a dedicated copy-aware workflow exists.

See [contract](../EVIDENCE_PUBLICATION.md). Remote unknown-outcome reconciliation is
required if an adapter is admitted later, not simulated by this local implementation.
