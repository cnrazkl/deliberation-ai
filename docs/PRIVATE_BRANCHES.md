# Selected-member private branches — DA-096 / DA-097

DA-096 supplies encrypted draft storage and branch management. DA-097 adds explicit reviewed one-model delivery for OpenAI-compatible source members with default reasoning and web search off. Saving/opening/refreshing a draft still makes no provider call. Council execution and selected-member reruns are unchanged. Other provider/settings combinations remain unsupported by this increment.

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

The conversation FK restricts identity deletion. Source/parent IDs have no cascading FK: frozen copies survive source retention and can describe unavailable boundaries. Parent deletion is not implemented. Branch reads validate encrypted conversation/source/member/parent identity, counts, unique message IDs and revision/copy provenance against the row. Foreign ownership drift fails instead of producing an apparently complete export.

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

Message editing/deletion, private branch deletion, retained-conversation erasure, secure erasure and backup/export file deletion are not implemented. Deleting the original run does not erase branch copies. Backups/downloads remain independent copies that can restore content. No real owner content is deleted during acceptance.

The exhaustive backup audit includes `conversation_private_branches.body_ciphertext` with authenticated decryption and body/row identity/count/revision checks. Restore verifies conversation/source membership and any present parent's ownership/source identity and reports branch counts. Archives predating the whole new table remain readable; a present table with missing/undeclared ciphertext columns fails closed. Populated disposable-restore evidence is recorded in [acceptance](DA096_ACCEPTANCE.md).

## Remaining scope

Broader native-provider/reasoning/search support, in-flight cancellation, message/private-body deletion, council accounting integration, authoritative billing and input/tool/money budgets remain open. Selective/semantic compaction and real-provider/human accuracy acceptance remain unverified.

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
One request is capped at 1,024 output tokens, 64 KiB input, 128 KiB response and 16,384
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
