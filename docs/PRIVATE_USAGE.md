# Private branch usage observability — DA-114

DA-115 adds a separate [conversation-wide view](CONVERSATION_PRIVATE_USAGE.md), including
deletion audits and deduplicated origins. The branch-local policy below is unchanged.

Expandable **Bu dalın token kullanımı** reads the already loaded owner-scoped branch
DTO. It creates no API call, job, stored ledger or provider request; no migration.

Only receipts originating in the open branch contribute. Copies are shown separately
as provenance and never counted a second time. Other branches and deleted-body audit
records are not loaded: this is a branch view, not a conversation-wide total.

Prepared, cancelled-before-submit and failed-before-submit slots are not provider sends.
A submitted timestamp, submitted/terminal-uncertain status or retained result/usage
identifies a recorded send. Pending and unknown/discarded outcomes remain explicit;
acknowledging uncertainty does not prove no usage or charge. Metered/textless failures
retain observed usage.

Groups separate connection, model, input-kind and output-kind. Receipt `usage` is
preferred, with legacy successful-result counters as fallback. Each counter retains
known subtotal and reported/send denominator. A complete group total requires every
send's counter. Missing values remain unknown; reported zero stays zero. A group with
no known values has no subtotal, and an empty branch has no computed usage total.

Cache/read/write, reasoning and provider-total counters remain separate. Inclusive
cache/reasoning are never added again. Uncached input stays separate from cache counters;
Gemini candidates stay separate from thoughts. Missing provider totals are never
reconstructed. Unknown/provider-defined conventions have explicit notices. No cross-group
total, invoice reconciliation, settled cost, money enforcement or council billing integration.
Raw receipt details, original content and provenance remain inspectable.

## Verification

Domain cases cover copies, null/zero/partial counts, metered failures, pending/discarded
uncertainty, pre-submit slots, legacy counters and differing conventions. Real-worker
loopback browser cases cover all four providers, lost-response deduplication, denominators,
unknown usage, copied-only children and 390px layout, plus draft/fork/deletion flows.
Screenshots use generated content. Current check results are in CURRENT_STATE.md.

4 October acceptance: 288 units, six private draft/deletion/delivery browser cases and
one mobile visual repeat, type checks, zero-warning lint and separate-output production
build passed. The 390px usage screenshot was visually inspected. No DB schema/migration,
provider adapter, paid call or real owner deletion change. No full browser/integration
sweep is claimed for this read-only projection.
