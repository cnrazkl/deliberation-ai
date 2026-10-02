# DA-099 local acceptance — native OpenAI Responses private delivery

Accepted: 2 October 2026, primary local repository. Extends reviewed private delivery
to matching OpenAI source connections with default reasoning and search off. This is
local software acceptance, not cloud/model quality, full billing, erasure or all-provider chat.

## Change

The separate private text adapter sends reviewed model/text/order to `/responses`,
using the saved native base URL or `https://api.openai.com/v1`. Reconstructed archived
assistant turns carry `phase: final_answer`. Explicit `store/background/stream=false`,
disabled truncation, plain-text format and the existing 1,024-token cap define stateless
text continuation. No tools, council schema, effort override, previous-response/
conversation reference, retrieval or retry is added. Native connection drift/settings/
ownership/risk checks reuse the preview/claim boundary.

Discriminated validation accepts terminal assistant text and empty-summary/content
opaque reasoning envelopes; only text/usage enter storage and future input. Unsupported
items, commentary, refusal, visible reasoning, annotations, inconsistent status and
malformed/oversized text fail with valid observed usage retained. Output-cap partial
text is marked truncated; output-cap no-text failures have a specific warning and
usage receipt. Queued/in-progress responses stay unknown and require acknowledged
closure before editing/forking, without remote polling or automatic resubmission.

The UI labels cache-input/reasoning-output as included subsets, keeps missing counts
unknown and warns that reasoning can consume the cap before visible text appears.
Requests/results retain existing encrypted private versions and permanent allowances.
No migration, council adapter/billing or provider-managed history change is made.

## Evidence

- All 266 offline unit tests across 41 files passed. Six new native cases cover exact
  request/header/phase translation, inclusive usage, output order/cap/no-text handling,
  invalid/refusal/tool/commentary/visible-reasoning rejection, remote pending outcomes,
  invalid input with zero fetch and bounded HTTP/body/deadline failures with no retries.
- All 155 PostgreSQL tests across 19 files passed in a generated isolated database.
  Default/custom native targets freeze reviewed input, replay once, retain usage in
  exports/forks and reject source-provider/settings/risk/endpoint drift before execution.
  The archive fixture contains both OpenAI and Anthropic private receipts; actual
  pg_dump/pg_restore authenticates/decrypts their bodies and matches the stored ciphertext.
  Temporary archive/restore databases and the generated test database were removed.
- Three focused private browser flows passed, then all 23 browser flows passed in one
  full run. Real pg-boss/worker calls loopback fixtures only. A lost committed enqueue
  response retries the same intent to one provider request. Native OpenAI then sends a
  separately reviewed second follow-up with the prior reply, records metered no-text
  failure, preserves remote-pending uncertainty, blocks edits/forks, requires explicit
  closure and copies receipt provenance into a fork. Opaque state is absent from saved/
  resent content; missing pending usage stays unknown.
- Package/web/worker/root type checks, zero-warning lint, separate `.next-verify`
  production build and dependency audit passed; no known vulnerabilities reported.

No paid/cloud model call, JEV activation, owner-history pruning or application migration
ran. Private browser fixtures remove only generated identities. Disabling API response
storage does not prove zero retention or account data controls. Intent headers do not
certify provider-side deduplication. Usage is not invoice cost or a monetary budget.

## Next work and limits

Native Gemini private delivery is next. Broader settings, provider-managed reasoning
continuation, remote receipt retrieval, in-flight cancellation, private-body/copy
erasure, council accounting and hard input/tool/money controls remain open. No real
model/cloud compatibility or answer-quality claim is made. The existing eight permanent
branch requests and output/storage bounds remain; prior blocked cache cleanup is unresolved.

[Mapping and current official OpenAI documentation](PRIVATE_BRANCHES.md#da-099-native-openai-responses).
