# Coordinator review declarations

The offline knowledge workflow binds completed text and format reviews and their
third-person adjudications to a coordinator's explicit independence and coverage
declarations. It prepares no human decisions and cannot accept model quality or release.

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
