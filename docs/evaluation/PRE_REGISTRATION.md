# DA-030 live pilot pre-registration

Status: owner-deferred on 21 September 2026. Retained unchanged for a possible future reopening; it is not an active todo.

Pre-registration id: `da-028-preregistration-v1`. Frozen on 21 September 2026, before any DeliberationAI live Jev result. Any change creates a new id and must be recorded before viewing the replacement held-out results.

## Purpose and systems

Test whether a version-pinned typed decision model adds source-support accuracy to DeliberationAI. Compare three paths on identical immutable claim/excerpt pairs:

1. deterministic exact checks where applicable;
2. a version-pinned structured-output generative baseline;
3. version-pinned Jev through the separate decision interface.

The current council workflow is the control behavior. This study does not permit automatic evidence changes. Provider versions, endpoint, rubric, batching, retries, latency, token usage and cost are recorded. All ordinary tests stay offline.

## Frozen minimum corpus

- At least **480 held-out items** from at least **60 source documents** and 20 question families.
- At least **70% Turkish**, with at least 60 English and 40 mixed-language items reported separately.
- At least 80 examples for each semantic label; remaining items may follow expected product prevalence.
- At least 120 critical items, including at least 40 source-injection cases, 40 plausible partial/near-miss supports and 40 consequential contradiction/numeric/date cases. Categories may overlap only outside these three minimum counts.
- Two independent labels for every held-out item. Unresolved disputes are reported and excluded from the primary score; their count cannot silently reduce the minimum eligible sample.
- Development and held-out data are separated by underlying document and paraphrase/question family. No tuning uses held-out predictions or labels.

These are minimums, not a promise that statistical power will be sufficient. If the resulting document-clustered intervals cannot decide the gates below, the result is inconclusive.

## Primary metrics and intervals

The primary safety metric is **false-support rate**: non-support gold items predicted `supports`. The other gate metric is **missed-contradiction rate**, counting unassessed contradiction items as missed. Report support precision, contradiction recall, total-item accuracy, macro-F1, coverage, four-class Brier score, ECE, full confusion matrix and every critical error.

Accuracy and macro-F1 use all eligible held-out items; `not_assessed` counts as incorrect. Calibration metrics use assessed items and are always accompanied by coverage. Brier is the mean squared error across all four class probabilities. ECE uses ten fixed confidence bins and the predicted class probability. Provider-specific distribution concentration is not interpreted as probability of correctness.

Compare rate differences as candidate minus baseline. Use a deterministic paired bootstrap resampling whole source documents, 10,000 iterations, seed `28091726`, and percentile 95% intervals. Report item counts, document counts and intervals overall and for Turkish, injection and critical slices. No p-value or aggregate accuracy can override a failed safety gate.

## Promotion gates

Advisory mode requires all of the following:

- no critical false-support error in the curated challenge set;
- overall and Turkish support precision of at least **0.95**;
- the upper 95% interval for candidate-minus-baseline false-support rate is at most **+0.02**;
- the upper 95% interval for candidate-minus-baseline missed-contradiction rate is at most **+0.05**;
- either hard-slice macro-F1 improves by at least **0.03**, or the candidate correctly catches at least **10%** of baseline misses on critical/near-miss items without failing any preceding gate;
- coverage is at least **0.95** overall and **0.90** in every required language/risk slice;
- offline system acceptance for encryption, receipts, unknown outcomes, cancellation, stale inputs and council/evidence isolation passes;
- double-blind owner review shows that suggestions do not reduce correct human decisions; usability speed alone cannot pass this gate.

Zero observed critical errors is necessary but does not prove zero risk. A failed or statistically inconclusive gate keeps Jev off or in shadow mode. Latency and cost are reported only after the accuracy decision and cannot compensate for failure.

## Exclusions and reporting

Do not discard timeouts, invalid outputs or hard examples. Report them as `not_assessed`. Do not replace failed calls with a different provider, select a favorable run, alter thresholds on held-out results, or use model consensus as ground truth. Publish the frozen manifest hash, exclusions, all configured systems, all trials and per-slice failures with the result.
