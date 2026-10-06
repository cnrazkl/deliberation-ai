# DA-123 implementation verification

6 October 2026. Scope: explicit owner submissions, stored round-0 model citations
and run packet excerpts in a human inbox; immutable originals and linked conflicts;
separate content/freshness review. [Contract](EVIDENCE_CANDIDATES.md).

## Verified behavior

- 325 offline unit cases / 54 files pass, including strict candidate origins,
  exact owner characters, unsafe URL/oversize/implicit-review rejection and restored
  provenance origin consistency.
- 244 isolated PostgreSQL cases / 28 files pass. Four candidate integration cases
  cover false/stale/conflicting originals; stored citation identity and absent
  source-text guards; changed/revoked local versions; idempotent races, owner
  isolation, encrypted storage and reviewed run deletion. Final targeted rerun of
  all four also verifies linked legacy-source deletion refusal and concurrent
  mixed manual/candidate intake reaching, but not exceeding, the shared ten-source
  quota. Manual intake and research promotion now share owner serialization;
  the complete final 244-case suite passes after that concurrency correction.
- The 44-case browser suite passed 43 cases, including candidate inbox and actual
  server policy, but the existing mobile sidebar visibility test failed once.
  The final candidate/workspace subset passed all ten cases, including that mobile
  test, without a claimed causal fix to the sidebar. Final expanded candidate test
  passed again after verifying populated 390 px cards and expanded model provenance
  have no horizontal overflow. Desktop/mobile screenshots were inspected locally.
  Candidate flow verifies lost committed-response retry, independent rejection/stale
  decisions, model verification HTTP 409, cross-origin HTTP 403, strict HTTP 422,
  streamed oversize HTTP 413, explicit download, reload and zero new council requests.
- Populated generated `pg_dump`/`pg_restore` verifies exact candidate provenance,
  retained original quote, rejection/stale decisions and inaccessible observation
  after scope revocation, alongside existing packet/source version checks. Generated
  databases and archive are removed; owner data is not dumped/restored.
- Typecheck, zero-warning lint, dependency audit (no advisories), seven lint
  compatibility checks, frozen cohort status and four extraction snapshots pass.
  Schema comparison preserves all 37 existing tables with only the nullable
  provenance column and extended freshness constraint. Domain/provider prompts are
  unchanged by candidate intake.

Production build, all 777 documentation links, staged-content and full-history secret
scans pass. The previous main Security checks run `37372170575` completed successfully;
remote checks for the new publication are separate from these local results.
Migration 0053 is applied only to generated test databases. No owner data migration,
paid model call, automatic evidence promotion or external publication is performed.
DA-119 independent human labels and DA-126 empirical quality acceptance stay open.

## Publication dependency correction

The first DA-123 main publication (`17a0c98`) failed Security checks run
`37438922429` at the dependency audit: GHSA-68fv-2mgg-jv7q affects transitive
`source-map-js` versions below 1.2.2. The earlier local audit reported no advisories;
that result did not establish a passing remote check. A workspace override now pins
all consumers to the patched 1.2.2, with no other package versions changed.
The fresh local audit reports no known vulnerabilities and frozen installation passes.
All 325 unit cases, seven lint compatibility checks, typecheck, zero-warning lint,
production build and four frozen extraction fixtures pass again with this graph.
Publication checks for this correction must pass separately.
