# Human format review compilation

DA-126 has an offline compiler for the eight frozen PDF/image review cases.
It validates human declarations; it never invents labels or human judgments, or
certifies gold, semantic entailment, independence or release acceptance.

`pnpm knowledge:prepare` creates blank text and format worksheets under ignored
`.local/knowledge-evaluation/reviewer-a/` and `reviewer-b/`. Existing files are
preserved. The frozen plan, protocol, questions and fixture bytes are unchanged.

Each reviewer inspects the original binary and its extracted page text, fills a
distinct `reviewerId`, and completes all eight cases in `format-worksheet.json`.
Each case needs `originalInspected: true`, boolean `extractionVerified` and
`noAnswerRequired`, and a rationale of 10–2,000 characters. Older blank forms lack
`originalInspected`; the reviewer must add it after inspection. Never regenerate
or overwrite an existing review to add this field automatically.

Answerable cases require claims with a statement, critical flag and exact
`evidenceQuotes: [{ page, text }]`. Quotes must occur exactly once within the named
page; line breaks and Unicode remain exact. Unverified extraction requires
abstention and no claims. The scanned PDF and ambiguous image remain mechanically
unverified; a reviewer cannot promote them into supported extraction. Verified
text may still receive an explicit human no-answer judgment.

Run `pnpm knowledge:compile-format-reviews` after both reviewers finish. Before
writing anything, the command re-extracts all four actual binaries and compares
the result with [the frozen snapshot](evaluation/KNOWLEDGE_EXTRACTION_SNAPSHOT.json).
It checks the current [frozen plan](evaluation/KNOWLEDGE_EVALUATION_PLAN.json),
original hashes, question identities, page spans/digests, original slots and
distinct declared reviewer IDs. The pure evaluation compiler accepts a trusted
extraction snapshot; the CLI performs the actual binary verification.

Both valid results are written to ignored `compiled/format-review-a.json` and
`compiled/format-review-b.json`. Existing outputs are refused. Results bind the
plan, exact extraction file, normalized worksheet and original/page/UTF-16 quote
spans. Reviewer declarations stay local and are not printed by the command.
Blank/incomplete forms fail validation; no substitute decisions are generated.

Different IDs cannot prove different people or independent work. Every compiled
result retains `humanIndependence: not_attested`, `adjudication: not_assessed` and
`releaseAcceptance: blocked`. Human adjudication, representative coverage review
and paired real model/cost/recovery measurements remain open under
[DA-126](DA126_ACCEPTANCE.md). Text adjudication remains a separate workflow.

## Third-person format adjudication

After both original format worksheets are complete, run
`pnpm knowledge:format-adjudication:prepare`. It revalidates the actual binaries
and original worksheets, then creates ignored `adjudicator/format-worksheet.json`.
The form retains both original compiled reviews and their digests, exact extraction
file/plan digests, and a conservative list of differing case decisions. Differences
in claim order/text/critical flags, evidence, extraction or abstention are exposed;
this comparison is mechanical, not semantic agreement scoring.

No final choice is copied from either reviewer, including when their decisions
agree. A third person fills `adjudicatorId` and every case using the same inspection,
quote, abstention and rationale fields as the reviewer forms. Each rationale must
explain the final judgment, including resolution of any disagreement. The third
declared ID must differ from both original IDs. Keep `reviews`, `reviewSha256`,
`disagreementCaseIds`, original case identities and plan/extraction digests intact.

Run `pnpm knowledge:format-adjudication:compile` to revalidate all inputs and write
ignored `compiled/format-adjudication.json`. Changes to validated original review content
after preparation invalidate the adjudication form; existing forms/results are
preserved rather than overwritten. Both conflicting originals remain beside the
final independently entered decisions. Every final quote is validated again against
its original page. Unverified scan/image extraction still requires abstention.

Output marks `adjudication: human_declared`, not certified gold. It retains
`humanIndependence: not_attested`, `goldAcceptance: not_assessed` and
`releaseAcceptance: blocked`. Different declared IDs do not prove three people or
independent work. Coordinator coverage/independence attestation and empirical
acceptance remain separate requirements. No reviewer identity, rationale or claim
is printed in CLI failure messages.

Adjudication compiler verification: 374 unit cases / 60 files, workspace/scripts
typecheck, zero-warning lint, frozen plan status, actual extraction verification and
dependency audit pass. Fourteen new offline cases exercise blank decisions, third
identity, stale/hash-substituted originals, hidden disagreements, missing/changed
cases, invented quotes, unsupported extraction and retained conflicting claims.
Both CLI commands reject the current incomplete human forms without changing their
hashes or creating adjudication forms/results. No runtime/browser/database change
requires additional integration acceptance in this increment.

Adjudication implementation `69ede73` is on remote main;
[Security checks 37453289246](https://github.com/cnrazkl/deliberation-ai/actions/runs/37453289246)
passed. All 835 documentation links and staged/full-history secret scans pass.
At 13:57 Istanbul, interactive web returned HTTP 200, database and one worker were
ready, and no queued/running runs or unresolved provider attempts were reported.

Offline regression tests use explicitly synthetic declarations only. They check
blank refusal, exact quotes, frozen identities, unsupported extraction, abstention,
distinct slots/IDs, tampered spans and rehashed invented extraction. No model,
database, migration or owner review is generated.

Local verification: 360 unit cases / 59 files, strict workspace/scripts typecheck,
zero-warning lint, frozen plan status, all four actual extraction fixtures and
dependency audit pass. The CLI rejects the existing incomplete local forms without
creating compiled review files. Tests include rehashed extraction tampering. This
offline-only increment requires no new database/browser acceptance.

Implementation `44a575c` is on remote main. All 833 documentation links resolve.
[Security checks 37452146951](https://github.com/cnrazkl/deliberation-ai/actions/runs/37452146951) passed.
Staged and full-history secret scans pass. At 13:47 Istanbul, web returned HTTP
200, the database and one worker were ready, and no queued/running runs, unresolved
provider attempts or active schedules were reported. DA-126 remains open.
