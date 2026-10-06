# Coordinator review declarations

The offline knowledge workflow binds completed text and format reviews and their
third-person adjudications to a coordinator's explicit independence and coverage
declarations. It prepares no human decisions and cannot accept model quality or release.

## Read-only evidence status

`pnpm knowledge:review-status` inspects current local human worksheets, revalidating
the frozen plan/intake/protocol and actual binary extraction first. Unlike
`knowledge:status`, which only inspects public frozen preparation, this command
checks both original reviewer pairs, adjudications and coordinator declarations.
It does not consume compiled outputs as authoritative evidence or write any files.

Each gate is `missing` for an absent file, `invalid` for a present incomplete,
malformed, unreadable, stale or inconsistent input, `blocked` when a present input
cannot be checked until its prerequisites pass, or `validated` for structural
validation against current sources. Pair gates expose duplicate identities/slots;
they are blocked until both individual forms validate. An absent dependent form
remains missing even if its prerequisites are blocked. A blank form is incomplete,
not a successful review.

The report contains gate states and declared independence/coverage flags only,
without participant IDs, rationales, questions, source text or claims. A structurally
valid coordinator can still report inadequate coverage or unconfirmed independence.
Even all validated gates retain pending owner gold review, unassessed model results
and blocked release acceptance. This command does not assess cost/recovery evidence
or establish that the declared participants are independent humans.

On the current local files, four blank reviewer forms are invalid, both pair gates
are blocked, and text/format adjudication plus coordinator forms are missing. The
next human work is completing the two independent source/format reviews; existing
files must be preserved. Structural validation cannot replace those judgments.

Readiness verification: 390 unit cases / 61 files, workspace/scripts typecheck,
zero-warning lint and dependency audit pass. Four new offline cases cover mixed
missing/invalid/blocked states, complete negative declarations, stale coordinators,
duplicate reviewer identities and content-free output. Actual CLI execution validates
the frozen binary extraction and preserves original reviewer file hashes. Normal CI
runs the same command without local evidence, retaining missing inputs.

## Coordinator workflow

Complete the original reviewer text/format worksheets and both adjudicator worksheets
first. `pnpm knowledge:attestation:prepare` revalidates the frozen plan/intake/protocol,
actual binary extraction, both original reviewer pairs and both adjudications. It
creates ignored `.local/knowledge-evaluation/coordinator/worksheet.json` only when
all evidence is structurally valid. Existing files are preserved.

The blank form includes exact plan/extraction, text labeling/corpus and format
adjudication digests, case counts and declared participant IDs. It does not contain
prefilled coordinator identity, date or decisions. These are bindings to validated
declarations, not independent proof of source authority or who performed the work.

The coordinator fills `coordinatorId`, ISO `reviewedAt`, boolean
`independenceConfirmed` and `coverageAdequate`, `limitationsAcknowledged: true`,
and a 20–4,000 character rationale. Verify that actual humans independently reviewed
sources before seeing each other's decisions or model outputs, that adjudication
resolved the disagreements, and that source/language/format/conflict/staleness/
no-answer coverage is adequate for the proposed study. Preserve `bindings` and
`bindingSha256`. The coordinator role does not automatically require a fourth person;
the protocol requires independent reviewers and a third adjudicator.

The 40 retained text cases and eight format cases are not automatically representative:
formats are a small development-only cohort, some inputs are synthetic, no-answer
scan/image behavior cannot establish OCR accuracy, and derivatives are not independent
source families. Counts alone cannot satisfy the frozen protocol's coverage gate.
If independence or coverage is inadequate, record `false` with the reason instead
of substituting a favorable decision. Corpus/label changes require a new hashed study
version before results; do not tune the retained held-out cohort.

`pnpm knowledge:attestation:compile` revalidates the evidence and writes ignored
`compiled/attestation.json`. Changed validated review/adjudication content, extraction
bytes, source intake, participant bindings or plan invalidates the form. Incomplete
forms, missing prerequisites and existing outputs are refused. Local identities,
rationales and claim content are never printed in failure messages.

Positive flags are recorded as `human_declared`; negative flags retain
`not_attested` independence or `not_accepted` coverage. Every result keeps
`goldAcceptance: requires_owner_review`, `modelMeasurements: not_assessed` and
`releaseAcceptance: blocked`. No machine certification of people, independent work,
representative coverage or gold follows from a completed form. The owner trial approval
is unchanged and remains separate from empirical acceptance under
[DA-126](DA126_ACCEPTANCE.md). [Format workflow](KNOWLEDGE_FORMAT_REVIEW.md).

Local verification: 386 unit cases / 61 files, workspace/scripts typecheck,
zero-warning lint, frozen plan status, all four actual extraction fixtures and
dependency audit pass. Twelve new offline cases check blank/negative declarations,
stale text/format decisions, replacement bindings, missing human fields, swapped
slots and changed source intake. Both CLI commands refuse the current incomplete
human evidence without changing original file hashes or creating coordinator outputs.
No runtime/browser/database behavior changes require additional integration tests.

Implementation `4e316cb` is on remote main;
[Security checks 37454065260](https://github.com/cnrazkl/deliberation-ai/actions/runs/37454065260)
passed. All 842 documentation links and staged/full-history secret scans pass.
At 14:04 Istanbul, web returned HTTP 200, the database and one worker were ready,
and no queued/running runs or unresolved provider attempts were reported.
