# Prompt comparison preparation — DA-073

8 October: the opt-in study dispatch CLI freezes and executes selected source-bound
original/additive pairs using identical members and one review round. One case was
tested with OpenAI/Qwen: both arms were partial, all eight attempts retained. Output
failures and reported over-cap usage cannot imply an accuracy improvement. Independent
drift/gold/answer reviews and the full comparison remain pending.
[Diagnostic execution](../NON_HUMAN_COMPLETION.md).

This offline protocol prepares a **paired** comparison for the current `prompt-revision-v1` additive candidate. It freezes the original source-inclusive question and its candidate for each of the 40 external-suite cases, with source, split and text digests. The candidate must retain the complete original exactly once, add visible text and fit the application question limit. The suite is implementer-selected and its sources are English; it is not a representative accuracy benchmark.

Run `pnpm prompt:prepare` once to write `plan.json` and two separate blank semantic-drift worksheets under ignored `.local/prompt-comparison/`. The command never calls a model and refuses to overwrite any existing preparation file. `pnpm prompt:status` reports the current structural state without printing question/source text. The current prepared state is 40 pairs, with both human reviews, adjudication, paired model runs and output judgments pending; measured accuracy is `null` and acceptance is blocked.

Each independent reviewer must inspect whether the candidate changes any intent, constraint or source handling and choose `meaning_preserved`, `material_change` or `uncertain` with a rationale for every case. A compiler rejects changed questions, missing cases, incomplete decisions and a mismatched plan digest. After two distinct reviewers have completed their files, `pnpm prompt:adjudication:prepare` creates a blank third-person worksheet. `pnpm prompt:adjudication:compile` verifies a third distinct identifier, both review digests and all final decisions. A case remains blocked if either reviewer or the adjudicator found material change or uncertainty. Identifier strings are not identity authentication; a coordinator must establish actual independence.

The prepared files do **not** yet compare model quality. A future controlled study must use the same frozen source cases and member/provider/model/reasoning/web/review configuration for both arms, vary only the selected question, and retain provider receipts plus owner-scoped run provenance. Both outputs need blinded, independent human judgments against an adjudicated gold corpus. Report development and held-out results separately, including missing/uncertain counts and critical losses; a pooled gain cannot excuse a held-out or critical regression. Do not infer improvement from the synthetic tests, the local candidate's wording, token cost or a structurally valid drift worksheet. No automatic model-generated rewrite is approved by this protocol.
