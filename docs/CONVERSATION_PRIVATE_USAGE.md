# Conversation private usage — DA-115

**Konuşmadaki tüm özel dalların token kullanımı** opens an optional summary beneath
the private-branch heading. **Konuşma kullanımını getir** reads a fresh snapshot; merely
opening the panel starts no scan or provider request. The checked time is shown and
the owner refreshes after new sends or deletion. The branch-local DA-114 view remains.

The no-store GET `/api/conversations/[id]/private-usage` validates the conversation ID
and reads one owner-scoped, repeatable-read, read-only database snapshot. It loads at
most 100 retained branches / 32 MiB ciphertext and 1,000 deletion audits / 32 MiB;
metadata output is capped at 2 MiB. Existing authenticated strict decoders are reused.
Missing/foreign conversations return 404. Foreign membership, unreadable records,
duplicate origin operation IDs and conflicting copies fail closed. No SQL migration.

An operation's origin receipt is counted once, regardless of copied branches. Origin
receipts retained in content-free deletion audits still contribute. Copies are counted
as provenance only. A copy with no retained origin is explicitly unattributed and not
converted into a new send; the UI marks conversation coverage incomplete. Live bodies
are decrypted only inside persistence; the response includes no prompts, replies,
request fingerprints, credentials or remote response IDs.

Groups use connection, provider-reported model and input/output counter conventions.
Unreported model identity remains unknown, including deleted unmetered outcomes;
requested model identity is not reconstructed. DA-114's branch view still groups by
requested model. Submitted timestamps, usage and submitted/uncertain statuses identify
recorded sends. Prepared/pre-submit cancellations are not zero-token calls. Missing
token values stay unknown; reported zero remains zero. Each counter shows coverage
and a subtotal; complete totals require that counter on every send in the group.
Cache/reasoning/provider totals stay separate and are never double-added or reconstructed.

This covers retained private metadata in one conversation, excluding council calls,
external copies, provider invoice reconciliation and settled monetary cost. Discarding
an unknown outcome does not establish absence of usage or charge. Original receipts
and provenance remain available through existing branch/export paths.

Client requests abort on unmount and fence late responses; conversation-keyed mounting
prevents an old conversation's summary appearing in another. Errors clear the previous
summary instead of presenting stale success. Existing semantic colors and wrapping
support dark/light themes and narrow screens.

## Verification

Domain cases exercise fork/audit deduplication, null/zero values, missing origins,
duplicate/conflicting receipts, order-independent counter identity and unknown models.
PostgreSQL fixtures exercise deletion retention, owner boundaries, metadata-only output
and authenticated conflicting copies. Real-worker loopback browser cases exercise all
four providers, copied children, no-store metadata, invalid IDs and 390px layout.
Current acceptance counts are recorded in CURRENT_STATE.md.

4 October acceptance: 294 units, all 207 isolated PostgreSQL cases, six focused
private browser cases, type checks, zero-warning lint and separate-output production
build passed. The 390px summary screenshot was inspected and the page-width check
passed. No full browser sweep or physical-device testing is claimed. Interactive
3000 remains HTTP 200 with ready DB and one worker after teardown. No paid call,
real owner deletion or SQL migration.
