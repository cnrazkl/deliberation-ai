# DA-100 local acceptance — native Gemini private delivery

Accepted: 2 October 2026, primary local repository. Matching Google source connections
with default reasoning and search off can send explicitly reviewed private text through
native generateContent. This is local software acceptance; model/cloud quality, richer
settings, erasure/accounting and provider-managed continuity remain unverified/open.

## Change

The separate private adapter preserves exact model/text/order, translating only the
leading instruction to systemInstruction and assistant roles to model text parts.
Saved custom or official default base URLs share existing owned preview/claim risk,
settings/provider/revision checks. API keys use headers rather than URL parameters.
One text candidate and the existing 1,024-token cap are requested without tools,
thinking override, remote state or council JSON schema. No migration or dependency.

Bounded validation accepts exactly one STOP/MAX_TOKENS model text candidate and rejects
visible thoughts, tool/media/unknown parts, safety blocks, grounding/tool metadata,
malformed/multiple candidates and excessive joined text. Opaque thought signatures on
plain text are discarded, never stored/exported/resent. This reconstructed text history
does not maintain the provider's original reasoning state. Partial cap replies display
truncation; no-visible-text cap failures retain observed usage and a specific warning.
Missing/unspecified finish reason stays unknown without polling or resubmission.

UI labels cache input as included and thought tokens separately from candidate-output,
showing the provider-reported total without inventing missing counts or invoice cost.
Existing encrypted receipts, permanent request slots, locks, queued cancellation,
acknowledged unknown closure and reply-aware provenance forks apply unchanged.

## Evidence

- All 272 offline unit tests across 41 files passed. Six new Gemini adapter cases cover
  native request/order/role/header/model mapping, native usage and opaque-state exclusion,
  partial/no-text caps and unavailable counts, unsafe/malformed/oversize output,
  unfinished uncertainty, no-fetch invalid input and bounded HTTP/body/deadline failures.
  Rejected failed content/credentials are absent from serialized errors; fetch never retries.
- All 156 PostgreSQL tests across 19 files passed in a generated isolated database.
  Google default/custom targets preserve reviewed input and execute once; provider,
  settings, risk and endpoint drift block dispatch. Native usage survives exports/forks.
  The archive test populated Google, OpenAI and Anthropic private receipts, used actual
  pg_dump/pg_restore into a disposable database, authenticated/decrypted encrypted fields
  and compared each stored branch ciphertext. Generated databases/archives were removed.
- All 24 browser flows passed in the final full run. Four private provider flows use
  real pg-boss/worker against loopback fixtures only. Lost committed enqueue responses
  retry the same intent into one provider call. Gemini additionally verifies native
  headers/body and candidate/thought UI, a reviewed second text follow-up, metered
  textless failure, unfinished unknown with absent counts, blocked editing/forking,
  acknowledged closure and copied receipt provenance. Opaque signatures are neither
  saved nor resent; no hidden provider retry occurs.
- The initial full browser run passed 23/24 with one pre-existing deletion-test question
  textarea mismatch (entered draft plus initial starter text). A focused two-test repeat
  passed unchanged. The deletion test now waits for its API-loaded card before editing
  the server-rendered controlled input; the final full run passed. The observed sequence
  suggests cold-load readiness sensitivity; it does not establish a general product
  hydration fix or prove that all input races are prevented.
- Package/web/worker/root type checks, zero-warning lint, separate `.next-verify`
  production build and dependency audit passed; no known vulnerabilities reported.

No paid/cloud model call, owner-history pruning, JEV activation or application migration
ran. Browser fixtures remove only generated identities. Intent headers do not certify
provider-side deduplication, output caps are not invoice budgets, and stateless text
does not certify zero provider retention or answer quality. Official API mapping and
counting sources are linked in [the private branch contract](PRIVATE_BRANCHES.md#da-100-native-gemini-generatecontent).

## Next work and limits

Next is explicit private-branch deletion policy and reviewed implementation, covering
copies/descendants, pending or unknown receipts, retained usage and backup/export limits.
Verification must use generated fixtures; owner-history deletion needs explicit owner
action. Richer settings, Interactions/provider-managed reasoning continuity, remote
receipt retrieval, in-flight cancellation, council accounting and input/tool/money
controls remain open. Earlier blocked cache cleanup remains unresolved.
