# Single-confirmation conversation deletion

Every saved conversation exposes **Sil**. It opens one centered native
dialog with **Bu konuşmayı silmek istediğinize emin misiniz?**, affected run/private
counts, retained-copy warnings and **Vazgeç / Evet, Konuşmayı Sil**. No checkbox or
separate private/run/metadata approval is needed. Cancelling removes nothing.
Conversation and council-template deletion dialogs preserve page position and return
focus to their trigger. They are mounted once outside hidden workspace views and
the council preview cards. Pending report-navigation scrolling cannot move an open dialog.

Only this conversation's owned terminal run bodies, owned private branches,
memberships, local knowledge selections/bindings/preparation packets and metadata
are deletion targets. Internal continuations/forks are included in the same scope.
An independent copy in another owned conversation/private branch or
published evidence stays intact: the dialog warns and lists its identifier. Those
logical source pointers may now identify unavailable content, while the copy retains
its frozen input, raw output/provenance and existing source identities. This explicit
retained-copy policy applies only to complete-conversation deletion; standalone
[run](RUN_DELETION.md) and [private](PRIVATE_BRANCH_DELETION.md) reviews keep their
existing copy blockers.

Active runs, prepared/submitted/unknown/unused retry-authorized provider work, private
deliveries, live execution leases, decision-assessment boundaries, foreign ownership,
index problems, unreadable provenance, inspection/audit capacity and unregistered
schema/FKs/triggers still block the whole operation. The dialog explains the blocker;
there are no nested deletion actions. The command never cancels, retries, refunds or
generates provider work and never removes another conversation or reusable library
source. Independent preflight/schedule inputs, billing, MCP results, downloads and
backups remain; old backups can restore deleted content.

Consumed retry permissions are historical: if a later attempt for the same run,
member and round exists, the earlier `retry_authorized` receipt does not independently
block deletion. A genuine submitted/unknown call remains unresolved even if a newer
attempt exists. Receipts and uncertain usage are preserved in strict v1/v2 deletion
audits; v2 reader/rollback compatibility is described in [RUN_DELETION.md](RUN_DELETION.md).
The preview returns bounded current-operation model/status/code/identity details
and active-run identities. The dialog shows them and offers explicit local discard
actions using the existing owned operator endpoint, without generation or retries.
An unconsumed terminal retry permission can be discarded only while acquiring the
worker execution lease and rechecking that no later attempt has consumed it.

## Atomic persistence and compatibility

GET `/api/conversations/:id/deletion?scope=content` reads an owner-scoped repeatable
snapshot and returns `conversation-content-deletion-v1`. POST with the exact
fingerprint and `confirmContentDeletion: true` rechecks the complete scope under the
owner membership lock, stable table locks and nonblocking council/private worker
leases. Every run/private body is inspected using its existing bounded schema,
ownership, provenance, pending-operation and content-free audit contracts. The
aggregate binds precise PostgreSQL timestamps, child fingerprints, local knowledge
row SHA-256 digests and sorted retained dependencies. New/changed content or copy
links invalidate confirmation. Leases are held throughout commit. An error anywhere
rolls back all bodies, audit inserts, bindings and metadata together.

Existing encrypted run/private deletion audits are created before body removal,
retaining usage/identity/provenance and fencing original creation intents. No new
table, migration or conversation tombstone is added. A completed aggregate is absent;
repeat POST returns 404, and after a lost response **Durumu Yenile** performs a GET,
recognizes absence and refreshes history without another mutation. Changed/failed
confirmation requires a fresh preview and another explicit confirmation. The legacy
unqualified GET and `confirmMetadataDeletion` POST retain their stricter empty-only
contract for existing callers; they cannot authorize populated deletion.

The aggregate allows at most 100 total memberships/private branches, 10,000 run-owned
content rows/64 MiB, 1,000 knowledge records/32 MiB and 100 retained dependency
identities. Existing per-body/global scans and audit capacities also apply. Knowledge
size/count checks precede row digest reads. Exact knowledge schema/FK checks and the
unchanged immutable update trigger are registered; any additional delete/cascade
behavior fails closed. Public evidence publication insertion is fenced during apply.
Strict 4-KiB confirmation parsing, no-store responses, authenticated owner and
same-origin mutation rules remain unchanged.

Successful deletion closes an affected open result/watch/private panel and refreshes
history. The question, member choices and other new-question draft fields remain.
Opening the dialog does not change the workspace tab. Verification deletes generated
fixtures only, never the owner's conversations, and enables no paid model tests.
