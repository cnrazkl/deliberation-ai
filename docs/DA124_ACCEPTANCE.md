# DA-124 verification

6 October 2026. Local reusable save and explicit manual handoff; no remote adapter
admitted. [Contract](EVIDENCE_PUBLICATION.md).

## Technical checks

- 327 offline unit cases / 55 files pass; publication contracts reject absent consent,
  substituted payloads, unsupported adapters and unsafe/unnamed manual targets.
- 246 isolated PostgreSQL cases / 28 files pass. Final six-case candidate/publication
  subset also passes after hash/restore validation hardening. New cases cover exact
  UTF-8 original round-trip, concurrent request replay and source deduplication,
  stale review/foreign grant/destination substitution, rollback after receipt-insert
  failure, searchable lexical copies, immutable SQL snapshots and copied-content
  run deletion refusal. Manual pending/acknowledged status remains distinct from
  remote verification; model-only/changed local candidates cannot be saved.
- Populated generated `pg_dump`/`pg_restore` retains exact local saves and manual
  acknowledgements after candidate rejection and grant revocation, with exhaustive
  encryption/owner/source read-back audit. One earlier restore attempt failed without
  identifying a cause; the subsequent identical verification passed. No causal fix
  or guaranteed absence of intermittent failures is claimed.
- Focused browser acceptance uses the actual BFF/database. It covers full preview,
  consent, changed-target invalidation, lost committed reply/retry, one copied source,
  manual download/acknowledgement, cross-origin 403, oversize 413 and zero new council
  requests. An initial exact label locator timed out; explicit select aria-labels fixed
  the ambiguity and the test passed. Final populated desktop/390-px mobile rerun passed (18.0 s); expanded publication cards retain receipts without horizontal overflow. The mobile screenshot was inspected.
- Typecheck, zero-warning lint, final production build and dependency audit (no known
  advisories) pass. The existing source/parser budgets and 37 prior tables are preserved;
  only the independent publication table is added by migration 0054.
  All 796 documentation links resolve; staged-content and full-history secret scans pass.

## Owner deployment

The owner separately approved backed-up migrations through 0054 on 6 October 2026.
Pre-migration `deliberation-20261006T091815Z-8aeecbae6cf2.manifest.json` and
post-migration `deliberation-20261006T091929Z-3b0771e5f2fe.manifest.json` both
restored into temporary databases and verified 434 runs, 7,457 encrypted rows and
12,005 values across 11 populated encrypted tables. Existing owner content was not
rewritten/deleted. Generated fixture restore, owner archive verification and active
runtime readiness are distinct checks. No paid provider or remote upload was invoked.
Independent human labels/model quality and external adapter admission remain open.


## Interactive runtime

Started web and worker from `c853/DeliberationAI` against the restored owner
configuration after all test helpers finished. On 6 October 2026 at 12:21 Istanbul,
`http://127.0.0.1:3000/` returned HTTP 200; `/api/local-diagnostics` reported database
ready, one ready worker, zero queued/running runs, zero unresolved provider attempts
and zero active schedules. Local knowledge state and publication-list routes returned
success. No synthetic owner source or model request was created for readiness checks.
The independent interactive processes remain running after browser tests end.

## Publication

Implementation commit `a43a2db` was fast-forward published to `main` without creating
a remote feature branch. [Security checks run 37442602442](https://github.com/cnrazkl/deliberation-ai/actions/runs/37442602442)
completed successfully, including dependency audit, frozen install, publication
contract/scoped knowledge checks, extraction integrity, lint compatibility and full
Git history secret scan. Local runtime readiness was checked again after publication.
