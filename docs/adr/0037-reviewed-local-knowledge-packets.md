# ADR-0037: Reviewed immutable local knowledge packets

Status: accepted for the DA-119 local trial; empirical rollout acceptance remains open.

## Decision

Use explicit conversation-scoped local lexical retrieval and bounded page-preserving
passages, with visible coverage and named omissions. Review freezes an immutable,
fingerprinted packet; exact council prompt/risk preview and current authorization
fence enqueue. Store a run-owned encrypted copy so source changes cannot rewrite
historical inputs. Recheck current authorization before each new round-0 submission.

No retrieval tool is exposed to models. All first-round seats receive the same packet
independently. Reviews do not resend sources. Repeated full-file input alongside a
packet is rejected. New-question continuations require explicit new preparation;
selected-member reruns reuse their inspected original packet under current permission.

## Consequences

No new service, vector index or notebook bridge is needed. Lexical first windows,
fixed budgets, fifteen-minute preparation freshness and retained preparations are
deliberately bounded trial policies, not semantic completeness. Owner review cannot
replace independent labels or measured injection/quality acceptance. Library and
preparation deletion, per-provider context acceptance, human inbox and admitted
external connectors retain separate tasks. The contract and verification record
must state these limits without claiming universal context fit or savings.

[Contract](../KNOWLEDGE_PACKETS.md), [architecture](../KNOWLEDGE_SOURCES.md).
