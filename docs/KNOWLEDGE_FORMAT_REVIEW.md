# Human format review compilation

DA-126 has an offline compiler for the eight frozen PDF/image review cases.
It validates human declarations; it does not produce labels, gold, adjudication,
semantic entailment, independence attestation or release acceptance.

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
`releaseAcceptance: blocked`. A third format adjudication workflow, representative
coverage review and paired real model/cost/recovery measurements remain open under
[DA-126](DA126_ACCEPTANCE.md). Text adjudication remains a separate workflow.

Offline regression tests use explicitly synthetic declarations only. They check
blank refusal, exact quotes, frozen identities, unsupported extraction, abstention,
distinct slots/IDs, tampered spans and rehashed invented extraction. No model,
database, migration or owner review is generated.

Local verification: 360 unit cases / 59 files, strict workspace/scripts typecheck,
zero-warning lint, frozen plan status, all four actual extraction fixtures and
dependency audit pass. The CLI rejects the existing incomplete local forms without
creating compiled review files. Tests include rehashed extraction tampering. This
offline-only increment requires no new database/browser acceptance.
