# Decision evaluation acceptance plan

Status: DA-028 offline foundation and DA-029 disabled-by-default execution boundary implemented on 21 September 2026. The owner deferred DA-030 live execution on the same date. A validated synthetic fixture, deterministic metric harness, labeling protocol, pre-registration, injected direct TypeSafe adapter, encrypted shadow persistence and locked result UI remain available. No production corpus, live result, or measured model improvement is claimed. This optional evaluation path is not a blocker for the completed local council. See [ADR-0017](adr/0017-advisory-decision-evaluation.md), the [Jev research](research/JEV_ASSESSMENT.md), [labeling protocol](evaluation/CORPUS_AND_LABELING.md), and [pre-registration](evaluation/PRE_REGISTRATION.md).

## Ground truth and first rubric

The evaluation unit is one immutable claim/excerpt pair. Labels are human-assigned from the supplied source with a recorded rationale and exact supporting/conflicting spans. Model agreement, model confidence, and current claim evidence states must not be copied into ground-truth labels. A source-support label does not certify the source itself.

| Label | Criterion |
| --- | --- |
| `supports` | The excerpt supports the entire material claim, including entity, scope, time and qualifiers, without a conflicting passage or an unstated assumption. |
| `contradicts` | The excerpt explicitly conflicts with a material part of the claim and does not also contain unresolved support for the same proposition. |
| `insufficient_evidence` | The excerpt lacks enough evidence, supports only part, or is internally mixed/ambiguous. This is not evidence that the claim is false. |
| `not_applicable` | The item is not a source-checkable proposition under this rubric, for example a preference or instruction. |

No excerpt, an invalid request, or a failed call is `not_assessed`, a system outcome outside these semantic labels. Non-comparable entities or dates must not force a contradiction. Preserve disputed human labels rather than silently manufacturing certainty. Have a second independent human review the held-out set; record adjudication and unresolved cases separately. If only the owner labels it, mark the experiment preliminary and keep advisory promotion pending independent review.

## Dataset and comparisons

- Turkish-first examples, with separate English and mixed-language slices. Include minority/red-team claims, negation, paraphrases, partial support, entity confusion, temporal qualifiers, numeric details, source conflicts, missing evidence, irrelevant/long text, and source-embedded prompt injection.
- Split by source document and question family before tuning. Paraphrases of the same source cannot leak across development and held-out sets. Freeze lawful source snapshots, capture/publication dates, labels, rubric versions and split identifiers; use synthetic or authorized non-sensitive content initially.
- Pre-register class balance, sample size, confidence level, risk slices, primary metrics and promotion margins before observing held-out results. Sample size must support document-clustered uncertainty estimates; a handful of excerpts cannot establish general superiority.
- Compare the existing workflow, deterministic checks, a structured-output LLM evaluator, and Jev using the same selected evidence and rubric. Keep identical source availability; allow fair batching/parallelism. Compare incremental defect discovery and false alarms without deleting original claims. A small double-reviewed UI study is required before claiming improvements to human decisions.
- Keep arithmetic, exact-span validation and date ordering deterministic. These checks may detect mismatch, but must not be represented as complete semantic verification.

## Metrics and promotion gate

The primary safety metric is false support: the fraction of non-support gold examples predicted `supports`. Also report support precision, contradiction recall, macro-F1, class confusion, coverage/abstention, and every critical error. Compute Brier/ECE from class probabilities against labels, not from the provider's distribution-concentration `confidence`. Report results by language and risk slice, sample counts and document-clustered paired uncertainty intervals. Calibration tuning uses development data only.

Before advisory release, require all of the following:

1. Frozen held-out evaluation shows the pre-registered useful improvement (such as additional correctly detected support gaps), not just faster execution or lower price.
2. False-support rate and missed-contradiction rate meet pre-registered non-inferiority bounds against the chosen baseline. Conservative target: no degradation; if the available sample cannot establish the chosen bounds, the result is inconclusive and stays shadow. Set numerical tolerances and required sample size before the live pilot, not afterward.
3. No observed critical false support on the curated challenge set, with explicit acknowledgement that zero observed failures does not prove zero risk. Turkish and injection slices must pass their separate criteria.
4. Offline system tests prove failure-as-unassessed, encrypted storage, replay, unknown-outcome retry blocking, cancellation, stale-input handling, isolation from council status, and no automatic mutation of evidence/synthesis states.
5. The owner-facing presentation clearly separates model suggestions from verification, retains all claims, and explains the source scope and uncertainty. Evaluation and approval are recorded against the exact provider/model/rubric versions.

Latency and cost are secondary descriptive metrics after these gates. Report all trials, not only the best run. Any model, endpoint, rubric, threshold or batching change that can affect results triggers regression evaluation. Inconclusive or negative results retain the unchanged council workflow; no automatic promotion occurs.

## Implemented offline harness

`@deliberation-ai/evaluation` validates corpus and prediction records independently of the council domain. It enforces exact evidence-span presence, unique item ids, document-level split isolation, complete prediction coverage, four-class probability sums, and selected-label consistency. It keeps `not_assessed` outside the semantic labels.

The deterministic report includes full confusion matrices, total-item accuracy, coverage, false-support rate, support precision, contradiction recall/miss rate, macro-F1, multiclass Brier score, ten-bin ECE, critical false-support ids, and language/risk slices. It also provides seeded paired document-clustered bootstrap intervals for the two safety rates. The checked-in Turkish-first fixture tests the machinery only; its perfect fixture predictions are not model results.

## Offline and live separation

DA-028 built the corpus specification and offline harness with deterministic fixtures; it cannot establish JEV accuracy. DA-029 implemented the disabled-by-default decision boundary and tests it with injected clients. The DA-031 interface can show shadow results but advisory promotion stays locked. DA-030 was owner-deferred and may be separately reopened after credentials, model selection and a qualifying corpus exist; it remains excluded from ordinary tests. Safe source retrieval and the completed local council do not depend on a successful JEV pilot.
