# Reviewed connection generation and model history

Implemented 7 October 2026. This completes the existing Group 5 capability-history
and bounded generation-check item in [TASKS](TASKS.md), not the whole operational
evaluation group or DA-119/DA-126 empirical acceptance.

## Owner workflow

Open Ayarlar → Yerel sağlayıcı bağlantıları → **Üretim testi ve model geçmişi**.
Opening, choosing a model, viewing instructions and refreshing records are local
read-only operations. The panel's model draft does not change the saved default,
council members, question, files or private branches. The existing catalog action
still only requests a list; it does not prove generation support.

The review shows the actual application instruction/user strings for a fixed
synthetic 2 + 2 request, connection revision and requested settings. A separate
checkbox authorizes one potentially charged generation. No owner conversation,
memory, knowledge packet, tool result or attachment is sent. Search is off;
normalized reasoning none can map to a provider default/lowest supported level.
The adapter requests 512 output tokens and has a 45-second timeout. Neither is
proof of remote enforcement, a spending limit or settled invoice cost.

**Yeni denemeyi incele** creates a fresh local intent and clears approval.
**Kayıtları yenile** retains that identity and only reads history. Resubmitting a
stored identity returns its receipt without another provider call. Inspect a
lost response using that identity first. Model/connection changes invalidate the
displayed approval. Success means valid structured output for this fixed request;
truth, representative quality and other reasoning/image/search modes are untested.

## Versioned observation storage

The existing authenticated catalog ciphertext accepts `provider-observations-v1`:
latest catalog, last ten revisioned catalogs and dropped count, plus at most 32
permanent generation intents per connection. Catalog entries bind revision,
provider/preset, original timestamp, model membership and normalized capability
fields. The panel projects the selected model across them. Missing fields/model
ids or a failed catalog do not prove unsupported generation.

Legacy latest-only catalogs remain readable as one historical entry with their
original revision/time; missing time stays unknown. Editing increments revision
and clears only latest suggestions, preserving history/intent IDs. An in-flight
catalog cannot attach to a changed revision. Locked catalog, edit and generation
transactions preserve each other's observations.

`connection-generation-v1` receipts bind intent UUID, model, connection revision,
provider/preset and SHA-256 of reviewed application prompt/settings. Fingerprints
are rechecked before dispatch. Provider wire framing is not archived. Changes to
the probe prompt/profile require a new version; no history certifies future models.

Retained fields: submitted/succeeded/failed/outcome_unknown, start/finish and
uncertainty acknowledgement times, fixed failure category, normalized HTTP error
status, returned model/response id, nullable provider input/output tokens and
elapsed time. Raw output/error bodies, credentials and owner content never enter
history or logs. Provider-reported output above the requested 512 is explicitly
flagged. Older receipts lacking the flag stay readable; their count still renders
the warning. Missing usage remains unknown. Probes are separate from council/
private usage and are not reconciled invoice ledger rows.

Generation identities are not evicted: the 33rd fresh intent is refused, while
old replay remains available. Connection deletion removes its scoped history;
backup copies remain separate. Unacknowledged submitted/unknown intents block
deletion. This history is not an account-level permanent financial ledger.

## Submission and interruption

An owned row lock durably encrypts submitted state before network execution.
UUIDs are canonicalized, so letter-case changes cannot create another intent or
alter encryption contexts. Duplicate UUID with changed model/fingerprint conflicts. Fresh intents are blocked
while unresolved work is inside the 45-second deadline plus five-second margin.
There is no automatic provider retry, polling, background queue or resend.

After the margin, a fresh paid call needs explicit acknowledgement that the prior
remote outcome and charge remain unknown. Alternatively **Belirsizliği onayla
(API çağrısı yapmaz)** acknowledges the expired intent via PATCH without a call.
It does not turn uncertainty into success or prove remote cancellation. Late
completion preserves that acknowledgement and the original connection revision.

GET `/api/provider-connections/:id/generation-check` is an owned no-store review.
POST/PATCH reject foreign origins and strictly validate streamed bodies up to
2,048 bytes. The provider package reuses all four actual council adapter families;
an application facade returns only normalized metadata to persistence. SDK values
remain inside adapters. Redirects are refused and response bodies bounded to
65,536 bytes. Timeout/network/unreadable responses remain unknown; known rejection
stays failed. Custom/local destinations keep the existing single-owner egress
boundary and must not be exposed to untrusted owners without a separate design.

No DDL migration is added. Restore auditing strictly validates legacy catalogs
or new envelopes. Older binaries cannot read new JSON envelopes: use current
source with a new archive, or a suitable pre-change archive for an old binary.
Matching migration journals alone do not prove encrypted JSON compatibility.

## Verification and live evidence

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
