# Security and logic audit - 16 October 2026

## Scope

The audit reviewed the primary checkout against PRODUCT, ARCHITECTURE,
CURRENT_STATE, TASKS and SECURITY. Parallel source reviews covered web/API
authentication and authorization, provider/MCP/retrieval transports, domain and
application orchestration, persistence receipts and worker dispatch. Dependency
and secret scanning complement the source review. There was no existing Graphify
graph in this checkout; relationships were traced through source and tests.

Verification uses offline fixtures, local HTTP servers and generated PostgreSQL
databases. No paid provider request, owner-history deletion, real-database schema
change or remote deployment is part of this increment. Existing Help content and
the disabled decision feature flag remain unchanged.

## Findings and corrections

| Finding | Correction and evidence |
| --- | --- |
| Council provider requests followed redirects. HTTP 307/308 could forward prompts and native credential headers to another destination. | Anthropic, Gemini, OpenAI Responses and compatible council transports explicitly reject redirects. Real local HTTP regression servers verify one original request and zero redirected requests for all four adapters, without retries. Transport failure retains unknown-outcome semantics. |
| A loopback MCP endpoint could redirect the SDK outside its validated destination. | The actual MCP transport rejects redirects, and a failed connection closes its client. A real HTTP redirect regression confirms no request to the second destination. |
| Rendered retrieval applied HTTP routing only to the initial page and did not intercept WebSockets. | HTTP routing belongs to the entire browser context, including the first popup navigation. WebSockets are closed without connecting; forbidden resource types are rejected before retrieval. Mocked regressions and an opt-in real Chromium test use private HTTP/WebSocket traps. |
| Many authenticated JSON routes parsed a complete unbounded body before schema validation. | The shared session boundary wraps request streams in a 20 MiB transport ceiling. It counts actual bytes even without an honest Content-Length, cancels on overflow and returns no-store HTTP 413. No extra body buffer is introduced; stricter route limits remain. Tests cover chunked, misleading-length, exact-limit and cancellation cases. |
| A run SSE stream checked the session only when opening the connection. | Each poll revalidates the session, ordinary-user role and owner scope under a short account lifecycle lease before reading newer data. Revocation, scope changes and consumer cancellation stop polling. Regression tests verify no additional run reads or sensitive events after revocation. |
| Several provider/decision receipt helpers trusted operation IDs without checking the current owner. | Reads and writes verify the owned parent run/assessment. Decision preparation also verifies ownership and serializes attempt allocation. Foreign-owner regression tests cover successful/failed contents, updates and submission. This closes an internal repository boundary; the audit did not demonstrate an exposed HTTP route exploiting these helpers. |
| Decision cancellation could commit after work started but before the worker unconditionally marked a receipt submitted. | Cancellation, preparation and submission serialize on the assessment row. A conditional prepared-to-submitted claim must win before dispatch. Cancellation terminates only never-submitted prepared receipts; actual submitted outcomes remain inspectable. The default-off feature remains disabled. |
| A consumed historical retry authorization blocked selected-member follow-up despite a newer successful attempt. | Follow-up admission ignores a retry grant only when a newer attempt exists for the same run/member/round. A genuinely unresolved newer attempt continues to block. Integration coverage checks both conditions. |
| Provider citation URLs accepted non-web schemes and embedded credentials. | New citations require credential-free HTTP(S). Historical unsafe links remain visible as text with provenance rather than actionable anchors. Schema, extraction and rendering regressions cover malformed and unsafe URLs. |
| Repeated unclosed HTML blocks caused quadratic regular-expression work, and invalid numeric entities threw RangeError. | Hidden blocks and title extraction use forward scans, with conservative omission of unclosed hidden content. Invalid Unicode scalars become U+FFFD. The same 640 KB input measured about 8,933 ms before and 3 ms after on this host; a subprocess deadline regression also covers repeated title tags and angle brackets below the byte limit. These measurements are local diagnostics, not a general performance benchmark. |

Slow SSE consumers also retain at most one queued event, preventing repeated
full run/report snapshots from accumulating while a client stops reading.

The migration startup regression now launches the real worker directly with Node's
tsx import hook. This removes shell/package-manager startup overhead and makes its
existing timeout target the worker process itself. Runtime startup behavior is
unchanged; the regression still checks both ahead/behind migration histories and
the absence of queue/heartbeat writes.

## Continuous verification

The Security checks workflow now runs every offline unit regression plus workspace
type checking and lint, instead of a selected subset of unit files. Frozen knowledge
status/extraction checks, lint dependency compatibility, dependency audit and full
Git-history Gitleaks remain. Network model tests remain opt-in; the real Chromium
trap test is separately opt-in because it requires a browser installation.

## Final local verification

| Check | Result |
| --- | --- |
| `RUN_RETRIEVAL_BROWSER_SECURITY=true pnpm test` | 537 cases across 95 files pass, including real Chromium. Ordinary CI runs 536 cases with the browser-only case skipped. |
| `pnpm test:integration:isolated` | All 300 cases across 42 files pass on the final frozen sources, including receipt ownership, cancellation, concurrent preparation/submission and follow-up guards. |
| `pnpm test:e2e` | All 125 browser scenarios pass on a generated database with local fixture providers. |
| `pnpm typecheck`, `pnpm lint` | Pass; web lint has zero warnings. Persistence types pass again after the test-launcher refinement. |
| `DELIBERATION_VERIFY_BUILD=1 pnpm build` | Production build passes in its separate output directory. |
| `pnpm test:lint-dependencies` | Seven compatibility cases pass. |
| Knowledge status, review status and extraction verification | Commands pass; four frozen extraction fixtures match. Human acceptance remains pending where documented. |
| `pnpm audit --audit-level=moderate` | Zero advisories at every severity on the reviewed lockfile. |

Intermediate integration runs included a source-edit overlap and a worker-startup
timeout under concurrent build load. The final complete run above passes after
sources were frozen and the migration fixture launched the worker directly.
Tests used the repository's Node 24 and pnpm 11 versions without a global tool update.

The isolated runners execute their generated-database drop in `finally`; the final
browser and database runners both exit successfully. A later inventory still
contained five other matching disposable names; they were retained because this
audit did not establish deletion authority for them. The test listener on port
3100 is closed. Native PostgreSQL, initially stopped, is stopped again. No remote
services were restarted or deployed. Staged and full-history redacted Gitleaks scans
are required before publication; source, lockfile and logs contain no added real key.

## Limits

This is a bounded source review and regression exercise, not a proof that all
possible vulnerabilities or logical defects have been eliminated. In particular,
the 20 MiB per-request ceiling is not a connection/concurrency rate limit and the
session checks cannot revoke bytes already delivered. A cancellation that loses to
an already committed submission cannot establish remote cancellation. User-selected
compatible provider endpoints remain an explicit trust decision.

Independent human/model-quality acceptance and longer operating observations in
TASKS remain separate. This increment makes no factual-accuracy, real-provider
billing, public-hosting or remote deployment acceptance claim.

Transport behavior was checked against the installed SDKs and official
[Playwright context routing](https://playwright.dev/docs/api/class-browsercontext#browser-context-route)
and [WebSocket routing](https://playwright.dev/docs/api/class-browsercontext#browser-context-route-web-socket)
documentation. The local malicious-server fixtures are the behavior evidence.
