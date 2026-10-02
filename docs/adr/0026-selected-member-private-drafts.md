# ADR-0026: selected-member private draft branches

Status: accepted for draft storage; live messaging remains open.

The council requires 2–6 independent initial members and structured claims. A one-model chat must not masquerade as a council or represent copied replies as newly generated responses. Retained metadata cannot be removed while private content depends on it.

DA-096 introduces a separate encrypted private draft aggregate inside an owned conversation. A server-authenticated preview binds the source question and one member's round-0 reply/configuration. Subsequent messages are owner drafts only. Immutable version-checked/idempotent appends and reviewed prefix forks retain original message provenance. No provider operation or council input is created.

Frozen copies survive source retention. A restrictive conversation FK and declared deletion blocker preserve identity. Complete conversation exports and exhaustive encryption/restore audits include the new content; independent backups/exports are not erased.

Future dispatch needs a dedicated request/response and receipt boundary plus reviewed delivery/risk/limits. Private-content deletion remains separate. [Contract](../PRIVATE_BRANCHES.md).
