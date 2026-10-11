# Connection tests and model history

## Current owner workflow (11 October 2026)

Creation and the Bağlantı tab offer **Hızlı Bağlantı Testi**. Saved connections also
have **Test ve Geçmiş**, with an always-open **Model Testi Ve Hata Ayıklama** area.
There is no extra generation toggle, fixed 2 + 2 preview or ordinary approval checkbox.
Choose a saved model, write a short message and click **Mesajı Gönder**. A larger
visible price notice explains the potentially charged API call. **Kaydet Ve Test Et**
first saves new/edited credentials; tab changes preserve connection drafts. Pending
sends lock fields, tabs and dialog dismissal. Closing/reopening or reloading clears
all new test messages, files and replies; previous test content is never rehydrated.

Each test sends only its current owner message and a short connection-test instruction,
without council, conversation, prior test, memory, sources or tools. The debug area can
add up to three small PNG/JPEG/WebP, PDF, WAV/MP3 files: 1 MiB each and 2 MiB combined.
FileReader works on private LAN HTTP without crypto.subtle. Server signatures, canonical
base64 and bounds are checked before dispatch. Files are not uploaded to library/run
storage, parsed locally or persisted. Only current test files reach the selected API.
Native/compatible mappings are listed in [PROVIDERS](PROVIDERS.md). Unsupported native
API mappings fail locally; model-specific rejection appears from the provider. OpenRouter
PDF tests pin native input, preventing implicit paid OCR from masking unsupported input.

Aliases are optional per selected connection model in the Modeller tab or creation form.
They appear beside exact IDs in council/test dropdowns, and never rewrite model identity,
council templates, execution targets or provenance. The one-time manual model field is
always visible inside the expanded model list. Preference-only saves preserve execution
revision and catalogs/history; removing a selection removes its alias.

## Transport, errors and replay

Owned no-store GET `/api/provider-connections/:id/chat-check` reads observations;
POST review/send use strict streamed JSON (2,850,000-byte ceiling), a trimmed message
up to 1,200 characters, and bounded files. Preparation fingerprints bind connection
revision, model, message/profile, transient mode and each file's name/type/SHA-256.
A second complete input digest prevents replay with changed files/message, even after
connection editing. A row lock durably records submitted state before the only call.
UUIDs are canonicalized; duplicate/replayed intent IDs never dispatch another request.

The transport requests 512 output tokens and 45 seconds, no tools/schema, provider-
default reasoning and no redirects. Replies are bounded to 16,384 characters and wire
responses to 131,072 bytes. Truncation, reported output above cap and nullable usage stay
visible. These are requested limits and observed counters, not cost/invoice guarantees.
Plain reply success does not establish structured council output, quality or future support.
HTTP/transport error codes, known provider error types and generated safe explanations
appear in the test transcript. HTTP-200 embedded provider errors are treated as failures.
Raw provider error bodies can echo secrets/input and never cross the adapter or enter logs.

New browser requests set transient=true. Their encrypted receipts store only input digest,
fingerprint, revision/model/provider, status, safe codes, timestamps, nullable usage and
response identity. Message/reply/file names/bytes/explanatory text are omitted from storage.
The browser holds visible results until dialog close/reload. **Sonucu Kontrol Et** reads
that existing receipt without generation; a lost response recovers status, never fabricates
or re-generates the missing reply. The Test ve Geçmiş tab shows only status/diagnostic
metadata and catalog observations, including previous legacy receipts.

32 permanent intent identities per connection retain the existing replay fence. They
are not automatically evicted; the next identity is refused at capacity. Legacy encrypted
chat replies and the fixed generation-check API remain readable/replayable, but the
ordinary UI no longer offers that fixed prompt. There is no migration, historical
rewrite, worker queue or automatic retry. Strict envelope readers must support new
optional fields before archive restore or binary rollback.

Submitted/unknown work blocks a fresh send inside the 45-second deadline plus five-
second margin. Afterward the owner must explicitly accept the prior uncertain charge
before a fresh call, or close its uncertainty through the existing PATCH without a
provider call. That exceptional uncertainty acknowledgement remains separate from the
removed routine send checkbox. Late completion preserves the original acknowledgement.
Connection deletion retains its unresolved-operation guard. Old backups remain separate.

## Retained fixed-check compatibility

GET `/api/provider-connections/:id/generation-check` still prepares the historical fixed
structured prompt. POST/PATCH retain their 2,048-byte strict/explicit-acknowledgement
contracts for compatible callers; the new free-message UI uses chat-check instead.
The fixed adapter still bounds responses to 65,536 bytes. This compatibility endpoint
makes no automatic calls and does not alter independent council round-0 execution.

## Primary transport references

- [OpenRouter audio inputs](https://openrouter.ai/docs/guides/overview/multimodal/audio)
- [OpenRouter PDF/native parser](https://openrouter.ai/docs/guides/overview/multimodal/pdfs)
- [OpenRouter error vocabulary](https://openrouter.ai/docs/api_reference/errors-and-debugging)

## Verification and live evidence

11 October simplification: 497 units, 290 isolated PostgreSQL cases and all 28 affected
browser checks pass, including transient content stripping, complete-input replay,
alias preservation across catalog/receipt writes, multimodal mapping/signature bounds,
safe provider diagnostics, close/reset and council-draft retention. Workspace types,
web lint and Linux production build pass. Generated-account tests on actual LAN HTTP
verify creation/edit aliases, image/WAV/PDF delivery, HTTP 400/unsupported_modality,
invalid-signature rejection before any dispatch, no routine checkbox and both palettes
at 320/1110px. Five synthetic loopback calls; no paid external generation. Temporary
account/connection/receipts and fixture server were removed. Deployment identity,
database/service baselines and observation window are recorded in CURRENT_STATE.md.
Earlier live provider checks below are retained historical evidence, not new acceptance.

Offline adapter tests exercise all four wire families, fixed input, one-call
behavior, requested caps, response bounds, known/unknown errors and the lowest
Gemini 3.7/3.8 Flash level. Application tests retain missing usage and refuse
unsafe metadata. Isolated PostgreSQL cases cover races/replay, foreign ownership,
edits/catalog writes during flight, stale review, unknown close, deletion guards,
32-intent capacity and catalog truncation. Real-route browser cases verify review,
draft preservation, reload/replay, reported-cap warning, trimmed model input,
mobile bounds and rejection before dispatch. CI uses fake transports only.

The owner explicitly authorized live checks on 7 October. Seven saved default
models were tested once; Gemini/Kimi received one diagnostic recheck each. Nine
intents were retained; no automatic retries or repeated successful calls.

| Provider/model | Result | Reported input/output | Elapsed |
| --- | --- | --- | --- |
| Qwen / qwen3.8-flash | Structured success | 328 / 262 tokens | 7,058 ms |
| Claude / claude-sonnet-5 | Structured success | 512 / 110 tokens | 2,095 ms |
| OpenRouter / qwen/qwen3.5-35b-a3b | Structured success; reported cap exceeded | 290 / 2,240 tokens | 19,260 ms |
| OpenAI / gpt-5.6-luna | Structured success | 349 / 58 tokens | 5,680 ms |
| DeepSeek / deepseek-flash | Structured success | 439 / 137 tokens | 1,234 ms |
| Gemini / gemini-3.8-flash | Recheck rejected, HTTP 402 | unknown / unknown | 273 ms |
| Kimi / kimi-k2.6 | Recheck rejected, HTTP 429 | unknown / unknown | 298 ms |

Five of seven models returned valid structured output. HTTP codes alone do not
establish balance, rate-limit cause or application fault. OpenRouter reported
2,240 output tokens despite requesting 512; cap enforcement/cause are unverified.
Actual invoice charges and owner-declared provider spending limits were not
independently verified. See [provider mapping](PROVIDERS.md) for the Gemini change;
the later HTTP 402 does not establish a previous thinking-level failure.

The opt-in helper uses the running local reviewed endpoint:

```text
pnpm connections:check:live --live <saved-connection-uuid> [more UUIDs]
```

It requires `--live` and 1–8 distinct IDs, reads no credential files, prints only
receipt metadata and never retries. Each invocation creates new potentially paid
intents. It is excluded from normal tests/CI; inspect existing evidence in the UI.

Real archive `deliberation-20261007T134754Z-13e2178ae894.manifest.json` restored
into a temporary database: 434 runs, 7,457 encrypted rows, 12,005 decrypted values,
11 populated tables and 504 conversations. The strict new-envelope audit passed
with retained live histories. Preserve the key separately per [operations](OPERATIONS.md).
