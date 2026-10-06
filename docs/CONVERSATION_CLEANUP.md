# Conversation deletion entry point — owner-requested insertion

Previously the conversation library exposed deletion only for entries whose run
bodies were already absent, inside Other operations. Populated conversations had
no deletion entry even though separate reviewed run/private deletion existed.

## Owner workflow

Every conversation card now exposes a visible deletion review. Populated entries
use **Konuşmayı silmeyi incele**; empty entries retain **Kayıt silmeyi incele**.
Opening focuses and scrolls to the review without changing the question draft,
model selection or generating a request.

The review lists the exact owned, still-present run bodies and private branches.
Choose a private branch or run to use its existing content-deletion preview and
separate acknowledgement. Remove copied leaf branches/descendant runs first when
their source preview explains a copy dependency. Active, pending/unknown, copy,
schema, ownership and size guards remain in force; a listed identity is an
inspection action, not a promise that it is eligible.

Each successful body deletion refreshes the conversation preview and clears the
old acknowledgement. Deleting the currently open run clears its result/watch but
preserves the new-question draft. Once the existing metadata policy permits it,
review and separately confirm **Konuşma kaydını kalıcı olarak sil**. The history
lists refresh after deletion. Preview failure offers manual refresh; a changed
server snapshot still requires new review.

These are separately committed actions. Cancelling later does not undo content
already deleted in an earlier confirmed step. No automatic batch/cascade, retry,
provider call or removal of another conversation is introduced.

## Persistence boundary

The existing owner-scoped repeatable-read preview adds `availableRunIds` and
`privateBranchIds`. Queries select identifiers only, each bounded to 1,001 rows to
detect overflow. More than 1,000 memberships hides the run list; more than 1,000
owned private branches hides the branch list and blocks metadata deletion. Neither
list returns a misleading partial preview. Foreign bodies/branches are not exposed
as owned deletion targets. No question, report or private ciphertext is read by
this added discovery path.

The client reuses [run-body deletion](RUN_DELETION.md), [private-branch deletion](PRIVATE_BRANCH_DELETION.md)
and [empty metadata deletion](CONVERSATION_DELETION.md). Each mutation rechecks its
own exact fingerprint and current guards in its existing transaction. A discovery
list grants no deletion authority. No new endpoint, schema or migration is added.

## Retained references and limits

Knowledge selections/preparations, independent approved evidence copies, copies in
other conversations and other retained references can still block the relevant
step. This flow does not silently clear those references. Existing content-free
usage/replay receipts, independent inputs, schedules, billing, backups and exported
files remain under their existing policies. Old backups can restore old content;
complete account/external-copy erasure is not claimed.

## Verification

A real-route browser scenario in a generated isolated database creates a two-run
conversation and a private branch, observes the source-copy blocker, separately
deletes the private branch and child/source bodies, then confirms metadata removal.
It verifies the draft, neighboring conversation and content-free receipts survive,
the deleted current result closes and no generation request occurs. Existing empty
metadata and run-deletion browser flows cover cancellation, stale confirmation,
lost-response replay, same-origin/strict-body limits and active/copy blockers.

PostgreSQL tests discover only owned existing targets without decrypting malformed
fixture ciphertext and refuse private-list overflow without exposing partial IDs.
Destructive verification uses generated fixtures only; no owner conversation is
deleted as part of development.
