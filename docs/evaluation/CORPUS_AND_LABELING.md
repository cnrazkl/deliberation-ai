# Source-support corpus and labeling protocol

Version: `source-support-v1`, 21 September 2026. This protocol supports DA-028. It does not establish Jev or any other model's accuracy.

## Unit and permitted material

One item contains one immutable claim, one immutable source excerpt, a source-document id, question-family id, language, split, risk tags, criticality, one semantic label, a short rationale, and exact evidence spans where the label is support or contradiction. Start with synthetic or explicitly authorized non-sensitive text. Do not copy current application evidence, private customer material, credentials, or model votes into the corpus.

The source-document id identifies the underlying document, not an excerpt. Every item derived from the same document and every paraphrase family must remain in one split. Development labels may be inspected while changing rubrics or prompts. Held-out labels are frozen before a live pilot and are not used for tuning.

## Labeling question

Read only the supplied excerpt and claim. Ask: **Does this excerpt support the entire material claim as written?** Do not use outside knowledge. Do not judge whether the source itself is trustworthy or current.

1. Choose `supports` only when the full claim, including entity, quantity, time, scope, causality, negation and qualifiers, follows from the excerpt without an unstated assumption.
2. Choose `contradicts` only when the excerpt explicitly conflicts with a material part of the claim. A different entity, missing fact or incomparable date is not automatically a contradiction.
3. Choose `insufficient_evidence` for absent, partial, mixed, ambiguous or merely adjacent evidence. This label does not mean the claim is false.
4. Choose `not_applicable` when the claim is not a source-checkable proposition under this rubric, such as a preference or instruction.

Missing input, invalid data, provider failure, context limit and invalid output are system outcomes named `not_assessed`. Annotators must never use `insufficient_evidence` to hide such failures.

For `supports`, copy at least one exact supporting span. For `contradicts`, copy at least one exact conflicting span. Spans must occur verbatim in the frozen excerpt. Record a rationale without adding facts not present in the excerpt.

## Independent review and adjudication

The held-out set requires two independent labels. Reviewers must not see model predictions, confidence, current application evidence state, peer labels or the expected class balance. Agreement is recorded before discussion. Disagreements receive one of these outcomes:

- a jointly accepted label plus adjudication note;
- an accepted label from a third reviewer;
- `disputed`, excluded from the primary score and reported separately.

If only the owner labels a pilot corpus, mark all findings preliminary and keep the feature in shadow mode. Changes to a frozen label, excerpt, split or rubric create a new corpus version and invalidate prior comparison results.

## Required challenge coverage

The complete pilot must contain Turkish-first examples and distinct English/mixed-language slices. Cover literal support, paraphrase, partial support, negation, dates, quantities, entity confusion, conflicting passages, irrelevant context, source-embedded prompt injection, minority claims and red-team claims. Critical items include plausible false support, missed contradiction, safety/security claims, consequential quantities and injection attempts.

The checked-in `offlineFixtureCorpus` is deliberately small and synthetic. It exists to test schemas, splits and metric calculations. It must not be presented as a benchmark or used to approve advisory mode.

## Quality checks before freezing

- Schema and rubric versions are present; ids are unique.
- Exact spans occur in the excerpt and match their support/conflict role.
- No document or paraphrase family crosses the development/held-out boundary.
- Class, language, document and risk-slice counts match the pre-registration.
- Critical cases receive independent review.
- Hashes and the final item manifest are stored with the evaluation result.
- Every evaluated system receives the same items, source text and semantic rubric.
