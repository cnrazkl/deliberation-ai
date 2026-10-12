# Workspace councils, connection dependencies and current-test diagnostics

## Council and chat workflow

**Konseyler** sits between Sohbet and Zamanlayıcı in the sidebar. It owns member,
model, role, reasoning, attachment, review-round and self-revision configuration;
owners create, update, copy and delete saved councils there. Chat only selects saved
councils. Unsaved changes or unavailable connection/model selections disable a new
run. Selecting a council does not generate or overwrite the question. Soru,
Kaynaklar Ve Dosyalar, Bağlam Ve Kontroller and Sonuçlar tabs retain mounted drafts
while hiding unrelated sections. Existing preflight/risk and frozen-run rules apply.
Question clarification does not block council creation, editing or selection. A
successful save adopts the server's normalized members only if the submitted draft
has not changed while the response was in flight.

## Connection mutation review

API connection deletion first returns an owned dependency preview. Removing selected
models or changing transport/credentials also requires review when references exist.
The review lists saved councils, run/conversation bindings, schedules, awaiting
preflights, private branches, pending provider/test operations and retained price,
billing and statement records. The browser additionally reports its current draft.
No historical member snapshot, template, billing record or source is rewritten or
cascade-deleted. Owners explicitly repair saved configurations before reuse.

Queued/running affected work, active affected schedules, pending private deliveries
and unacknowledged submitted/unknown operations block the change. Pause schedules
and resolve work first. Historical references require confirmation and remain
inspectable. A fingerprint binds the owner, current revision/model set, intended
change and inspected dependency evidence; changed evidence requires another review.

`provider-bindings-v1` owner transaction locks serialize connection mutations with
template saves, run/rerun admission, schedule creation/resume, preflight admission and
private delivery preparation. Local member bindings require the owned connection,
matching provider and exact selected model. Legacy environment-backed members without
a connection ID and fake fixtures retain their existing contracts. Existing replay
identities still return their recorded result; new work cannot bypass validation.

Inspection fails closed on unreadable encrypted content or exceeded bounds. Before
reading bodies, each encrypted category is limited to 1,000 owned rows and 16 MiB of
ciphertext. Conversation memberships, pending operations and connection price records
also have 1,000-row limits. These are inspection limits, not automatic retention rules.
No DDL or owner data migration is introduced.

## Exact test input and audit

Quick and debug tests use `connection-chat-v2`: one user message, unchanged text
(up to 1,200 characters, nonempty after whitespace checking), and only explicitly
chosen test files. No hidden system/instruction, council prompt, prior test history,
memory, web or tool content is sent. Private/council/synthesis prompt contracts stay
separate. Token/deadline parameters and provider file mappings remain transport
configuration; requested 512 output tokens and 45 seconds are not billing guarantees.

The **Test Ve Hata Ayıklama** tab shows only the currently sent test. Özet, İstek,
Yanıt and Aktarım expose application review/send HTTP status, the actual provider
request body and endpoint, response status/headers/body, timing, byte counts,
request IDs, usage and normalization stage, browser context and server runtime.
HTTP failures and malformed/partially read replies retain the safely captured body.
Unavailable information stays unknown; this cannot expose provider internals or
DNS/TLS packet captures. 401/403, 402, 404, 429 and transport diagnostics distinguish
reported access, payment, model/endpoint and network symptoms without guessing a cause.

**JSON İndir** exports this current browser record. Configured API keys, credential
headers/query fields, cookies and opaque provider state are redacted. Binary file
content is replaced by byte count and SHA-256; actual wire-byte count remains visible.
Responses are bounded to 131,072 bytes and marked when truncated. Message and visible
reply content remain in the export, so it is an owner-controlled diagnostic artifact.
No trace, test message/reply, file name/bytes or raw error body is written to logs or
new persistent receipts. Closing/reopening or reloading clears this browser record.
Legacy history is not rehydrated into this tab or returned by chat-check review/GET.

Content-free durable receipts retain the existing 32-identity replay fence and
uncertain-charge guards. They are not silently evicted. **Sonucu Kontrol Et** reads
an existing receipt, never calls the provider again and cannot reconstruct a lost
transient reply. Button hover descriptions explain these actions. Exceptional
unknown-result acknowledgement remains explicit; there is no automatic retry.

## Catalog provenance

Explicit catalog lookup uses the configured provider API, never an invented model
list. Google uses `/v1beta/models?pageSize=100` and includes entries advertising
`generateContent`; OpenRouter uses `/api/v1/models/user?limit=300`, OpenAI/compatible
use `/models`, and Anthropic uses `/v1/models?limit=100`. The authenticated source URL,
observation time, verification and partial-list flag are shown. At most 300 IDs,
4 MiB and ten seconds are allowed; redirects are refused.

A catalog is an observation, not proof that an account/project can generate with
that model. Selected/manual IDs can survive a catalog refresh, but removal from the
owner's selected list invalidates new council use. Google currently distinguishes
restricted Gemini 2.5 project access from announced deprecation; a 404 alone does
not prove retirement. [Google model API](https://ai.google.dev/api/models),
[Google deprecations](https://ai.google.dev/gemini-api/docs/deprecations).

## Modal interaction

File controls have a visible **Dosya Seç** action. A bubbling file-input `cancel`
event is ignored by the dialog's own cancel handler. Escape closes only an idle
dialog. Backdrop dismissal requires both pointer-down and release outside the modal;
a text-selection drag originating inside cannot close it. Explicit close, focus
restoration, scroll preservation and pending-operation dismissal guards remain.
