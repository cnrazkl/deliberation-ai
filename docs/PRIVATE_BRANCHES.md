# Selected-member private branches — DA-096 / DA-097 / DA-098 / DA-099 / DA-100 / DA-101

**DA-102 source boundary:** a surviving private branch, even with no owner messages, blocks reviewed source run-body removal because its seed is a content copy. Remove each private leaf through DA-101's separate review first. Content-free private deletion audits retain source/usage identifiers and do not block source-body removal. Age-based retention remains independent and can leave copied private content. [Run policy](RUN_DELETION.md).

**DA-101:** reviewed leaf-first content deletion is now available with copy/pending/worker/schema guards, retained encrypted usage/provenance and replay protection. Old create/fork request IDs cannot restore removed content; external backups/exports retain their copies. [Deletion contract](PRIVATE_BRANCH_DELETION.md), [acceptance](DA101_ACCEPTANCE.md). Increment-specific next-task statements below are historical.

DA-096 supplies encrypted draft storage and branch management. DA-097 adds reviewed one-model delivery for OpenAI-compatible source members; DA-098 adds native Claude/Anthropic, DA-099 native OpenAI Responses and DA-100 native Gemini generateContent. All require default reasoning and web search off. Saving/opening/refreshing a draft still makes no provider call. Council execution and selected-member reruns are unchanged. Other settings remain unsupported; earlier increment-next statements are historical.

## Owner workflow

1. Open a saved completed/partial report and expand a successful member under **Model ayrıntıları**.
2. Choose **Bu yanıtla özel dal taslağı aç** and inspect the copied source question and selected first-round raw response. Cancelling creates nothing.
3. Choose **Özel dalı kaydet**. The source version/content must still match the preview.
4. Write **Özel mesaj taslağı**, then **Taslağı dala kaydet**. This appends an owner draft without contacting a model. Saved messages cannot be silently overwritten.
5. **Bu noktadan yeni özel dal aç** copies the current saved prefix. Future parent/child messages are independent. Unsaved text follows the child without being saved automatically; switching branches keeps unsaved text in panel memory. Closing/reloading loses unsaved local text; committed drafts survive reload.
6. Use **Özel dal taslaklarını göster** in the conversation library to reopen branches even after all source run bodies have been pruned. **Özel dalı indir (JSON)** explicitly downloads one branch as plaintext.

The council question, model selections and source report are preserved. The initial label/model describes saved source configuration, not a tested connection or future dispatch selection. Drafts never enter council continuation, prompts, memory, cross-review, claims or synthesis.

## Frozen scope and provenance

`selected-member-private-seed-v1` freezes conversation/run identity, source state version, prompt version/fingerprint, original risk profile, selected member configuration, source question, exact round-0 raw response and `reusedFromRunId` when that response was copied by a member rerun. The preview SHA-256 binds the complete seed including conversation identity. The server constructs it; callers cannot inject seed bodies or credentials.

Other members, cross-reviews, original continuation input/private archives, attachments, memory/tool/evidence records and council provider receipts are excluded. The source question alone can be incomplete without those inputs. This is an archived selected reply, not reconstruction of the provider's original conversation or proof of accuracy. DA-097 assesses actual rendered input anew with the original risk floor and refuses high-risk private delivery.

`private-branch-drafts-v1` accepts only `owner-draft` messages. They retain UUID, original text, creation time, origin branch UUID and accepted revision. Forks freeze parent UUID/revision/message count and retain copied message origins. A child starts a fresh revision at 1; only its own appends increment that revision. No model/chair authority is introduced.

## Persistence and concurrency

Migration `0044_vengeful_anita_blake.sql` creates `conversation_private_branches`. Owner, source/member/conversation/parent IDs, counts, creation request identity/hash and timestamps are metadata. The complete question/reply/member settings/messages are encrypted with authenticated context `private-branch:<id>:body`. No credential or plaintext body column exists.

The conversation FK restricts identity deletion. Source/parent IDs have no cascading FK: frozen copies survive source retention and can describe unavailable boundaries. DA-101 blocks parent removal while copies survive; each copy requires separate reviewed deletion first. Branch reads validate encrypted conversation/source/member/parent identity, counts, unique message IDs and revision/copy provenance against the row. Foreign ownership drift fails instead of producing an apparently complete export.

Writers use the existing conversation owner lock before source/branch row locks. Root creation share-locks the owned source and rechecks the preview. Fork creation locks the owned parent and requires the reviewed revision. Appends lock the owned branch, check expected revision and append atomically. Lock waits are bounded to 5 seconds.

Owner-unique creation/fork UUIDs and request hashes deduplicate exact retries, even after source pruning or parent advancement; changed UUID reuse conflicts. Draft UUIDs identify one immutable accepted message: exact retry returns the current branch without another append. Changed text/revision or reuse of a copied ancestor's UUID conflicts. The browser retains mutation identities on ambiguous response failure, aborts/fences refreshed reads and preserves typed drafts on conflicts.

Limits: 100 branches per conversation, 64 total saved messages per branch including copied messages, 8,000 characters per draft, 262,144 characters per copied response and 512 KiB for the full UTF-8 body. Lists read metadata only and fail above 100 without truncation. Source preview bounds stored size before loading/decrypting the report. Export preflights encrypted size and then the existing 32 MiB whole-conversation JSON bound. These bounds do not guarantee model context capacity or cost.

## API and export

- `GET /api/runs/:id/private-branch-seed?member=<id>`: read-only selected seed and digest.
- `POST /api/private-branches`: strict `create` or `fork` intent.
- `GET /api/conversations/:id/private-branches`: metadata-only list.
- `GET /api/private-branches/:id`: authenticated branch body.
- `POST /api/private-branches/:id/messages`: strict owner-draft append.
- `POST /api/private-branches/:id/export`: plaintext `deliberationai-private-branch-export-v1`.

Responses use `Cache-Control: no-store`; mutations/downloads use the existing same-origin loopback boundary. Actual streamed mutation bodies are capped at 64 KiB. Unknown/foreign targets return 404, malformed payloads 422, stale/conflicting/inconsistent records 409, oversize 413 and pending source indexing 503. Errors omit body text and credentials.

Existing `deliberationai-conversation-export-v1` adds `privateBranches` in the same read-only repeatable-read snapshot as runs. All saved owner draft branches are included, even with unavailable sources. Internal creation hashes/UUIDs, encryption envelopes and credentials are excluded. The UI warns that private drafts are plaintext. Separate attachments/external/provider/accounting records retain existing exclusions.

## Retention, deletion and backup

Private content is retained by default outside run-retention cascades. DA-095 explicitly registers this table/FK and returns `private_branches` when any branch remains, even with zero owner messages because its seed contains content. Foreign branches block identity deletion too; private source references from other conversations also block removal. Undeclared columns/dependencies/triggers still fail closed.

DA-101 removes one reviewed private branch's stored content and retains content-free encrypted usage/provenance and replay evidence. Partial message editing/deletion, retained-conversation erasure, secure erasure and backup/export file deletion are not implemented. Deleting the original run does not erase branch copies. Backups/downloads remain independent copies that can restore content. No real owner content is deleted during acceptance.

The exhaustive backup audit includes `conversation_private_branches.body_ciphertext` with authenticated decryption and body/row identity/count/revision checks. Restore verifies conversation/source membership and any present parent's ownership/source identity and reports branch counts. Archives predating the whole new table remain readable; a present table with missing/undeclared ciphertext columns fails closed. Populated disposable-restore evidence is recorded in [acceptance](DA096_ACCEPTANCE.md).

## Remaining scope

Broader reasoning/search support, in-flight cancellation, partial message removal, cascading copy/backup erasure, council accounting integration, authoritative billing and input/tool/money budgets remain open. Native Gemini and reviewed leaf deletion are accepted within DA-100/101's bounded scope. Selective/semantic compaction and real-provider/human accuracy acceptance remain unverified.

## DA-097 reviewed private delivery

Save the owner message, choose **Gönderimi incele**, inspect the full ordered messages,
connection/model and exclusions, check the review box and choose **Kaydedilmiş mesajı
modele gönder**. The preview is read-only. Branch/input/connection drift rejects the
fingerprint; the worker rechecks connection revision and risk before submission.
Generated replies remain private content and never become canonical council claims.

One intent atomically appends an encrypted receipt and pg-boss job. Exact retries reuse
that intent after HTTP response loss. A session advisory lock fences overlapping workers;
a durable submitted receipt cannot be automatically resubmitted after restart. Pending
receipts are polled; replies, truncation, normalized errors and nullable observed usage
are displayed. Invalid-output responses retain observed usage when available. Missing
usage stays unknown. These receipts do not enter council-run price/billing totals.

An origin branch admits eight permanent request slots, including cancelled/failed/unknown
and discarded requests. Forks copy provenance and receive their own origin allowance.
DA-113 lets the owner review a 128–1,024 output-token cap per request (default 1,024).
The UI offers 128/256/512/1024; historical requests retain their approved limits.
[Settings and replay contract](PRIVATE_DELIVERY_SETTINGS.md).
One request is capped at 64 KiB input, 128 KiB response and 16,384
reply characters. Pre-enqueue capacity reservation protects the 512 KiB encrypted-body
plaintext limit. A branch holds at most 16 own/copied receipts. These are local limits,
not input-token accounting or a monetary spending guarantee.

Only queued work can be cancelled. **İşlem durumunu kurtar** asks the worker to check the
existing intent; it cannot authorize resubmission. Interrupted submitted work becomes
`outcome_unknown`. Explicit acknowledgement can close that record as discarded without
undoing a provider charge. A new message and fresh review are needed for another request.
Editing/forking is blocked while prepared/submitted/unknown work remains. Fork approval
binds both draft revision and delivery version and preserves completed reply provenance.

GET/POST/PATCH `/api/private-branches/:id/deliveries` is owner-scoped, no-store and
byte-bounded, with same-origin mutations. Plaintext exports include private request,
result and usage without credentials. Existing backups authenticate the extended body;
old bodies with no delivery fields remain readable. No migration is added.

## DA-098 native Claude/Anthropic

The owned source connection must match the frozen member provider. A native connection
without an explicit base URL uses `https://api.anthropic.com`; an explicit base URL is
the root before `/v1/messages`. Compatible connections still require a base URL. Review
shows provider, connection label, model and full ordered input; provider/endpoint/revision
drift invalidates review and fails claimed work before a network call.

The leading system turn maps verbatim to top-level `system`; remaining user/assistant
messages keep their order and text. Consecutive owner drafts stay separate in the
request, although the service can combine consecutive roles internally. Mid-history
system instructions and assistant prefills are refused. No thinking, effort, search,
tools, council JSON schema, automatic repair or network retry is requested. Existing
1,024-token output, byte/time/storage and receipt controls apply. The intent header
does not certify remote deduplication.

Only assistant text-block messages ending in `end_turn` or `max_tokens` are accepted.
Text blocks are concatenated without altering text; `max_tokens` displays truncation.
Tool/thinking/unknown blocks, refusal stops and malformed/oversized results fail;
valid observed usage remains on failed receipts without retaining failed raw text.
Interrupted network work stays unknown and is never automatically resubmitted.

Claude `input_tokens` are labelled **önbellek hariç**. Cache-read/cache-write counts are
shown separately when returned and as unknown when absent. These native counters enter
existing encrypted private results/usage, forks, JSON exports and backup auditing;
they are not invoice amounts or council billing records. No migration, new credential,
provider-managed history or old-body rewrite is needed. Local verification does not
attest cloud access, model compatibility or answer quality. [Acceptance](DA098_ACCEPTANCE.md).

Mapping follows the [official Messages API](https://platform.claude.com/docs/en/api/messages/create)
and [stop-reason guide](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons), checked 2 October 2026.

## DA-099 native OpenAI Responses

Matching owned OpenAI source connections use `/responses` after their base URL,
defaulting to `https://api.openai.com/v1` when no explicit URL is saved. Provider/endpoint/
revision and source settings remain review/claim guards. Selected model, message text
and order stay unchanged. Archived assistant replies are marked `phase: final_answer`;
source replies are reconstructed private context, not replay of an original provider
conversation. New output with a commentary phase is refused.

The request explicitly sets `store: false`, `background: false`, `stream: false`,
`truncation: disabled`, plain-text format and `max_output_tokens: 1024`. No effort override,
tools, council schema, previous-response/conversation ID, retrieval or automatic retry
is added. Disabling response storage is not a zero-retention/account-policy guarantee.
This is reviewed text-history continuation, not provider-managed reasoning continuation.

Only completed or output-cap-incomplete responses with valid terminal assistant text
messages enter the transcript. Text blocks are concatenated in order. Tool/refusal/
unknown items, visible reasoning summaries/content, nonempty annotations, inconsistent
statuses and excessive/malformed text fail with valid observed usage kept. Opaque
reasoning envelopes with empty summary/content may accompany text but are not stored,
exported or resent. Their presence alone is not a visible answer.

Output-cap incomplete text displays truncation; no visible text produces a failed
receipt and a specific warning, without repair/resubmission. Returned queued/in-progress
responses stay unknown and block edits/forks until acknowledged closure. Remote
completion/retrieval is not implemented. Cache-input and reasoning-output counters are
subsets of input/output counts; UI labels them as included, never adding them again.
Missing counts remain unknown. Review warns that the output cap includes reasoning
and can fill before visible text appears. Existing receipt/slot/storage/fork/export/
backup controls apply, without migration or billing integration. Gemini is next.
[Acceptance](DA099_ACCEPTANCE.md).

Checked against official OpenAI documentation on 2 October 2026:
[Responses create](https://developers.openai.com/api/reference/cli/resources/responses/methods/create),
[reasoning limits and usage](https://developers.openai.com/api/docs/guides/reasoning),
[response item structure](https://developers.openai.com/api/docs/guides/migrate-to-responses).
Input roles/assistant phases and opaque envelope fields also match installed OpenAI
7.15 SDK type definitions; no SDK migration or cloud compatibility claim is made.

## DA-100 native Gemini generateContent

Matching owned Google source connections use `/models/<encoded-exact-model>:generateContent`
after the saved base URL, defaulting to `https://generativelanguage.googleapis.com/v1beta`.
Provider/revision/endpoint/settings/risk guards apply at preview and claim. Credentials
use `x-goog-api-key`, never URL query parameters or bearer translation. Intent/request
headers are correlation, not a provider-side deduplication guarantee.

Leading system text becomes `systemInstruction.parts`; later exact message text/order
becomes `contents` user/model text parts. Consecutive owner drafts remain separate.
Request one candidate, `responseMimeType=text/plain` and `maxOutputTokens=1024` without
tools, attachments, cachedContent, thinking overrides, council schema or remote state.
Default thinking can consume the cap before visible output. This is reconstructed
text-only history; source/provider reasoning continuity is not restored. Thought
signatures attached to plain text may be received but are discarded, never stored,
exported or resent. No model-quality effect is claimed.

Exactly one model candidate with STOP or MAX_TOKENS may supply bounded plain text.
Parts reject visible thoughts, tools, media and unknown fields; prompt/candidate safety
blocks, unsupported stops, malformed/multiple candidates and excessive joined text fail.
MAX_TOKENS text displays truncation; an absent/empty visible answer creates a specific
failed receipt with observed usage retained. Missing/unspecified finish reason stays
unknown without remote polling, retrieval or resubmission. Existing receipt fencing,
permanent slots, queued cancellation and acknowledged unknown closure apply unchanged.

Prompt count includes cached input; candidate-output excludes separately reported
thought tokens. UI labels both conventions and displays the reported total without
inventing missing counts, summing subsets twice or claiming invoice cost/budget. Existing
encrypted bodies, reply-aware forks, exports and backup audits retain normalized text/
usage only. No migration or rewrite of existing bodies is needed.

Native local provider coverage is complete for this restricted private text boundary;
Interactions, expanded settings/continuity, accounting, erasure/copies and real-cloud
acceptance remain open. Next is reviewed private-branch deletion policy/implementation;
no owner history is deleted by DA-100. [Acceptance](DA100_ACCEPTANCE.md).

Mapping checked 2 October 2026 against official [generateContent API](https://ai.google.dev/api/generate-content)
and [generateContent thinking/signature and output-limit guidance](https://ai.google.dev/gemini-api/docs/generate-content/thinking).
The existing council generateContent path is retained; no Interactions migration is claimed.
