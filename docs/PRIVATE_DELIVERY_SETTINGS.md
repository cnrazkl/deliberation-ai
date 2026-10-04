# Reviewed private output settings — DA-113

The owner can select 128, 256, 512 or 1024 output tokens for the next private model
send. The default remains 1024. DA-116 keeps the selection separately for each branch
while its private-branches panel is open, including saves, worker polling, refreshes
and switching between branches. A new fork starts at 1024, independently of its parent.
Closing/reopening the panel or reloading the page resets these drafts; they are not
persisted branch/model defaults. Stored deliveries
display their exact approved cap. Lower limits may truncate output or leave no visible
text after reasoning. The value is not a usage estimate, invoice amount or money budget.

## Review and delivery boundary

Read-only preview accepts `maxOutputTokens`; the strict server contract admits integer
values 128–1024. Missing settings preserve legacy 1024 behavior. The rendered input,
including this cap, participates in the existing preview fingerprint. POST carries the
same cap and regenerates that fingerprint under the existing locks before enqueueing.
A changed cap with an old fingerprint fails before an operation/job is recorded.

The request's cap is frozen inside the encrypted receipt. Replaying its request identity
with a different cap fails even when the caller reuses the original fingerprint. Exact
retries preserve one intent after a lost HTTP response. The UI clears review after an
edit and locks editing while a send is unresolved; retry uses the original identity/cap.
Changing settings, previewing and opening a branch make no provider request.

The same adapters already map the frozen request to compatible `max_tokens` or OpenRouter
`max_completion_tokens`, Anthropic `max_tokens`, Responses `max_output_tokens` and Gemini
`generationConfig.maxOutputTokens`. No provider SDK value enters domain code. Default
reasoning/search constraints, source matching, conservative risk blocks, byte/storage
limits, eight permanent request slots and unknown-outcome handling remain in force.
The maximum allowance is not increased. No database migration is needed; old encrypted
1024 requests remain readable. New lower caps survive encrypted backup restore.

This advances the broader private-settings gate only. Model switching, richer reasoning
settings, provider-managed continuity, shared council/private billing and full-copy erasure
remain separate work. No paid-provider test is authorized by this increment.

## Acceptance

Provider tests reject invalid caps before network and admit the lower bound. Disposable
PostgreSQL tests check read-only previews, changed fingerprints, rejected tampering,
exact retry, one execution and encrypted request retention. A populated disposable
archive restore retains a 128-token native request alongside legacy/default receipts.
Loopback browser tests cover all four providers, editing after approval, lost responses,
frozen 512-token delivery, malformed/duplicate query values and existing failure/fork paths.
Current check results are recorded in CURRENT_STATE.md.

## DA-116 draft continuity

PrivateBranchesPanel owns a branch-ID keyed in-memory output-cap draft map. The delivery
selector is controlled by that map. Revision/delivery changes still remount the delivery
panel, discarding its preview, acknowledgement and request intent; only the selected
cap survives. Changing a cap clears review as before. A lost-send-response retry stays
locked to its original frozen intent and cap. Deleting a branch removes its local cap
draft after the existing confirmed deletion succeeds.

No setting is reconstructed from copied or historical receipts. No localStorage,
database, BFF, worker or adapter behavior changes. Two separately opened panels/tabs
have independent drafts. This improves local selection continuity only; provider-managed
reasoning continuity, persistent preferences, model switching and monetary limits remain
open. Selecting, saving, refreshing or switching a branch starts no model call.

Browser regression cases exercise cap preservation across committed/retried messages,
conflicts, refresh, successful replies, separate root/child choices and page reload,
alongside the existing four-provider frozen-cap/lost-response review boundary.

DA-116 acceptance on 4 October: 294 units, six focused browser cases plus a four-provider
follow-up repetition, type checks, zero-warning lint and separate-output production build
passed. No full DB/browser sweep was rerun for this client-state change. Interactive
3000 remains available with ready database and one worker after browser teardown.

4 October acceptance: 282 units, 204 isolated PostgreSQL cases (including actual
populated lower-cap restore), all 40 browser cases, type checks, zero-warning lint and
separate-output production build passed. The first browser run had a queued timeout
while older-code interactive workers shared the queue; the full repeat passed after
switching the interactive runtime to this checkout and removing old processes.
The mobile selector screenshot was inspected. No real history deletion, SQL migration
or paid/cloud provider call was performed.
