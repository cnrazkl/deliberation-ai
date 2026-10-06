# DA-125 verification

6 October 2026. Scope: distinct NVIDIA hosted connection/editor, conservative
compatible council/private mappings, queued revision fence and optional catalog.
See [contract](NVIDIA_PRESET.md). All provider transport cases use injected offline
responses; no NVIDIA credential, hosted generation or paid model call is used.

The eight new offline cases cover exact hosted/key/model contracts, request URL,
headers and output allowance, absence of unsupported fields, validated council
output, raw invalid output with observed usage, missing private usage, plain-text
private mapping, HTTP 202/503 unknown outcomes, catalog-only metadata, manual
fallback and pre-network rejection. Two PostgreSQL cases cover ciphertext,
key retention within one service, fresh-key requirements across services, stale
catalog rejection, immutable queued revision, rejected mismatches and zero
network/receipt submission after an edit. Browser acceptance covers the actual
saved BFF/database connection, fixed editor settings, clearing a different service's
draft key, manual task model, optional mocked catalog and mobile editor width.

Passing local results:

- `pnpm test`: 335 cases / 56 files.
- `pnpm test:integration:isolated`: 248 cases / 29 files in a generated disposable
  PostgreSQL database, including both NVIDIA boundaries.
- Isolated Playwright `nvidia-preset.spec.ts` and `model-catalog.spec.ts`: two
  browser cases, including a 390px mobile editor check; actual connection writes
  stay in the generated database and hosted catalogs are mocked.
- `pnpm typecheck`, `pnpm lint` (zero warnings) and
  `DELIBERATION_VERIFY_BUILD=1 pnpm build` pass.

The remote Security checks workflow includes the offline NVIDIA test file.
Final audit, secret-scan, publication and runtime observations are recorded below.

`pnpm audit --audit-level=moderate` reports no known vulnerabilities; seven lint
dependency compatibility cases pass. Interactive `http://127.0.0.1:3000/` returned
HTTP 200 at 12:47 Istanbul; diagnostics showed the database and one worker ready,
zero queued/running runs, unresolved provider attempts and active schedules.

Live NVIDIA key/model access, model-specific output limits, vision/reasoning/schema
capabilities, NVIDIA-side idempotency and request-id reconciliation are unverified.
DA-119 independent human labels and DA-126 empirical quality/cost/recovery acceptance
remain open; offline fixtures cannot close them. No SQL or owner-data migration is
introduced. Previously authorized deployment through 0054 remains unchanged.
