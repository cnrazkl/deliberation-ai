# DA-098 local acceptance — native Anthropic private delivery

Accepted: 2 October 2026, primary local repository. This extends DA-097 private delivery
to matching Claude/Anthropic source connections with default reasoning and search off.
It does not accept every provider, cloud/model quality, billing or private-content erasure.

## Change

The reviewed stateless input translates to native `/v1/messages`: the first system
instruction becomes `system`; subsequent user/assistant text and order remain intact.
Native auth/version headers replace compatible bearer auth; the output cap stays 1,024.
Absent native base URLs resolve to the official root, while compatible endpoints still
require an explicit base URL. Preview/claim reject source-provider mismatch, unsupported
settings and changed endpoint/provider/revision. Worker dispatch uses the checked target.

The shared 90s deadline/128KiB response boundary refuses redirects and never retries.
Native text-only `end_turn` and `max_tokens` normalize to completion/truncation. Unexpected
blocks/stops, malformed/empty/oversized text fail while preserving valid observed usage
without failed raw content. Network interruption remains unknown. UI labels native input
as uncached and shows cache-read/write counts separately; absent counts stay unknown.
Existing encrypted private bodies, versions, forks and exports are reused; no migration.

## Evidence

- All 260 offline unit tests across 41 files passed. Five native adapter cases cover
  exact translation, native counters/truncation, invalid blocks/stops/text, invalid input
  with zero fetch, bounded HTTP/body failures and unknown disconnect/deadline outcomes.
- All 154 PostgreSQL tests across 19 files passed in a generated isolated database.
  Added cases cover default/custom native targets, exact input, one-execution replay,
  encrypted usage/export/forks and no-network mismatch/settings/drift rejection.
- After extending the archive test to a populated native receipt with cache counters,
  all 154 database tests passed again. Actual pg_dump/pg_restore into a disposable
  database authenticated/decrypted the private body and compared its stored ciphertext.
  Temporary restore databases/archives and the generated test database were removed.
- Focused compatible/native browser flows both passed, then all 22 browser flows passed
  in one full run. They use the real pg-boss worker and loopback HTTP fixtures. A lost
  committed enqueue response retries the same intent to one first provider request.
  The native flow shows truncation/cache counters, sends a separately reviewed second
  message with the prior private answer, then forks with copied receipt provenance.
- Package/web/worker/root type checks, zero-warning lint, production build in the separate
  `.next-verify` directory and dependency audit passed; no known vulnerabilities reported.
- Gitleaks scanned the full staged source snapshot with the repository configuration
  and redaction enabled; no secret findings were reported. Local data/environment files
  and generated outputs are outside that publication snapshot.

No paid/cloud provider request, JEV activation, owner-history pruning or application
migration ran. Private browser fixtures delete only their generated identities. Current
diagnostics show ready database/worker, one worker and zero council backlog/unresolved
attempts/active schedules. Diagnostic counters do not certify private-queue emptiness.

## Limits and next work

Durable single-intent controls, eight permanent branch slots, bounded output/storage,
queued-only cancellation and acknowledged unknown closure remain as in DA-097. An intent
header does not establish provider-side idempotency. Replies remain untrusted private
content and do not enter council claims/billing. Native OpenAI Responses is the next
bounded provider increment, then Gemini. Other settings, in-flight cancellation, private
erasure/copies, authoritative billing, input/tool/money enforcement and live/human quality
acceptance remain open. This increment does not resolve the previously blocked cache deletion.

[Request/response mapping and primary sources](PRIVATE_BRANCHES.md#da-098-native-claudeanthropic).
