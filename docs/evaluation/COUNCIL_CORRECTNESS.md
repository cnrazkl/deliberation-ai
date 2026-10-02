# First work package: correctness controls

DA-068, 27 September 2026. The owner requested the first broad work package and then explicitly chose: complete technical preparation, leave independent human review open. Technical preparation is delivered. Human acceptance and measured model quality remain pending. This document is the concrete checklist for group 1 of `PLAN_GAP_AUDIT.md`; it does not reopen TypeSafe/JEV.

| Acceptance item | Evidence | Status |
|---|---|---|
| External-domain, source-bound candidate intake | 40 cases, 11 frozen primary-source excerpts, 10 document/question families, six declared domains; 20 development / 20 held out; hashes and leakage checks | Technical preparation complete; human coverage approval pending |
| Independent gold labels | Two separate blank claim worksheets, quote-to-span compiler, third-person adjudication, explicit coordinator attestation | Tools complete; two people and a third adjudicator pending |
| Authentic source-level model measurement | Source-inclusive question packets; read-only PostgreSQL binding; report-bound assessment worksheet; held-out and pooled metrics; strict acceptance CLI | Tools complete; real runs and human output judgments pending |
| Automatic semantic contradiction design | Bounded candidate ranking, one injected evaluator batch, complete unassessed inventory, exact quote/scope validation, two human pair-review worksheets and adjudication, candidate recall / end-to-end recall / false alarms | Offline shadow prototype and regression tests complete; hosted adapter, independent pair labels and live evaluation pending before product activation |
| Acceptance result | `pnpm correctness:status`; scoring only from regenerated adjudicated gold and persisted, source-bound runs | Correctly blocked pending human review and measurements |

## External candidate suite

`COUNCIL_EXTERNAL_SUITE.json` freezes excerpts from NASA, USGS, NOAA, CDC, NIST and CFPB. Domains are astronomy, earth science, weather/ocean, health, measurement and finance. Questions are 26 Turkish, 10 English and four mixed; the **source passages are English**. This is a broader, implementer-selected candidate set, not a statistically representative sample, a native-Turkish-source benchmark or evidence of real-world accuracy. Reviewers must assess source relevance and coverage before signing the attestation. Long documents, jurisdiction-specific law and native Turkish source collections remain limits of this initial dataset.

The source registry records URL, document/family identity, capture time, publication/update date when observed, usage note and UTF-8 SHA-256 of the curated text. It rejects changed text, duplicate ids, disguised URL aliases, unused sources and document/text/family leakage across splits. A two-source bundle retains the lineage of each underlying document. Each question freezes the rendered bundle; quote offsets refer to that exact text. Whitespace, NIST mathematical typography and the CFPB table were flattened explicitly in `scripts/freeze-external-council-intake.mjs`; the hashes are for these curated excerpts, not the original HTML bytes. Rerunning the freeze script requires `--write` and refuses an existing file.

The source-conflict family preserves an observed disagreement: the NASA [Pluto facts](https://science.nasa.gov/dwarf-planets/pluto/facts/) excerpt says 2006, while the captured [Planet X](https://science.nasa.gov/solar-system/planet-x/) excerpt says 2016. The questions require preserving the conflicting attributions. No script resolves it by authority, majority or outside knowledge. A later webpage correction must create a new dataset version rather than silently replacing the captured discrepancy.

## Human labeling handoff

`pnpm correctness:prepare` has created `.local/external-council-labeling/` with:

- `intake.json`, `source-manifest.json` and 40 source-inclusive questions in `measurement-plan.json`.
- `reviewer-a/worksheet.json` and `reviewer-b/worksheet.json`, both blank and without split/risk labels or model answers.
- `attestation.template.json`, deliberately incomplete with all confirmation flags false.

Give the two review files to separate humans. Follow [the quote-based worksheet guide](COUNCIL_REVIEW_WORKSHEETS.md), using the external flag:

```powershell
pnpm labeling:compile --external
pnpm labeling:adjudication:prepare --external
# A third human completes adjudicator/worksheet.json.
pnpm labeling:adjudication:compile --external
```

After adjudication the coordinator copies `attestation.template.json` to `attestation.json`, enters identity/time, copies `labelingInputsSha256` from `compiled/manifest.json`, and confirms independent human work, no access to model outputs during labeling, and source-coverage acceptance with a rationale. Distinct strings do not authenticate people; this is an explicit coordinator attestation, not an automated proof. The agent has filled none of these decisions or confirmations. Existing project-only worksheets remain separate and untouched.

## Model measurements after labels exist

The existing council UI/worker remains the generation path. A new bulk provider runner is not introduced. For each configuration being tested:

After DA-069, source packets may trigger the automatic lexical risk floor. For this mixed-domain study, pre-register the high profile, red-team and review consistently for every case rather than changing controls between cases. This setup instruction does not authorize running the study or alter the frozen questions/gold protocol.

```powershell
pnpm measurement:prepare comparison-a
# Execute the exact questions in measurement-plan.json using the existing UI.
# Enter saved run ids into measurements/comparison-a/run-map.json.
pnpm measurement:review comparison-a
# A human fills assessment-worksheet.json: represented/missing/uncertain,
# actual occurrence ids, and a rationale per gold claim.
pnpm measurement:score comparison-a
```

The measurement commands themselves never call a model. Plan/budget approval for live execution still precedes those council runs. Freeze the selected model ids, reasoning levels, roles, review count, risk profile and prompt version before collecting results; keep them fixed across a comparison. Record all attempts, including failed/unavailable runs (null mapping), and report every configuration, not just the best. Source packets exclude gold labels and contain both the question and exact source text. Questions exceeding the application's 4,000-character limit fail rather than truncate.

The new loader reads a local-owner report and its settings from one database row snapshot. It requires a terminal report, the exact source-inclusive question, current matching prompt version/fingerprint, remote members, no extra memory/tools/attachments or web search, one consistent council configuration, and successful round-0 receipts for successful members. Reusing a run for two cases is rejected. The older `evaluateStoredCouncilCoverage` question-only function remains a diagnostic compatibility API and cannot establish this stronger source binding.

The output worksheet freezes source/gold text, run id, the entire report and its digest. Compilation rejects altered text, stale reports, missing judgments and invented occurrence ids. A missing run stays `not_assessed`; a blank decision cannot become success. `result.json` records policy, suite, corpus, labeling, attestation, assessment and configuration hashes plus per-run prompt hashes and available token counters. Missing provider counters remain null, and these counts are not prices. The local worksheet contains plaintext report content and is ignored by Git. Existing output files are never overwritten.

Selected model ids and local receipts do not prove an immutable hosted model revision or eliminate alias/backend changes. This initial measurement evaluates a fixed declared local configuration. Versioned provider capability history belongs to the later operational package.

## Frozen acceptance policy

`council-correctness-v1` is frozen before live measurements:

- At least 40 cases, 10 external source records, 10 families, five domains, 20 cases per split, 60% Turkish questions, English and mixed questions, and all eight risk tags. Independent humans must approve the actual coverage.
- At least 95% conservative claim recall overall and on held-out cases, separately for held-out Turkish, English and source-conflict slices.
- Zero critical missing claims in each checked slice. Critical unresolved/unassessed claims block acceptance; an empty critical denominator also blocks. A known critical miss remains a failure even while other judgments are pending.
- Unknown counts remain unknown. No fixture result, blank label, unassessed run, pooled score that hides held-out failure, or majority vote can pass the measurement CLI.

The score is source-level preservation on this small frozen corpus, not a calibrated confidence interval, universal factual accuracy or proof that the sources are true. Independent adjudication and representative sampling remain human responsibilities. Full 0/1/2/3-round comparisons depend on the later bounded-deliberation package; the application currently supports 0/1 review rounds.

## Semantic contradiction shadow boundary

The offline `planContradictionReview` accepts an audited report, hashes ordered claim statements/scopes, source-set digest, evaluator version, policy and pair budget, and plans at most 200 pairs from at most 120 claims. Lexical overlap ranks candidates; differing conditions never eliminate a pair. Every omitted pair remains explicitly `not_assessed: budget`. Candidate recall is measured against **all** human-labeled pairs, including omissions. It is not claimed to understand semantics or to be faster/more accurate than another design.

`runContradictionReview` takes an injected `ContradictionEvaluator`, sends one batch without model identities/raw answers, and validates the entire batch's fingerprint, pair coverage, unique ids, exact quotes from both claims, scope compatibility and rationale. Results are `contradiction`, `compatible` or `unresolved`; a failed, malformed, mismatched or missing batch becomes `not_assessed`, with no retry. It returns shadow suggestions and cannot modify claims, evidence state, owner relations, synthesis or completion.

Prepare blind, all-pair human worksheets for an existing terminal local run:

```powershell
pnpm contradiction:labels prepare pair-study <run-uuid>
# Two separate humans fill reviewer-a.json and reviewer-b.json.
pnpm contradiction:labels adjudication-prepare pair-study <run-uuid>
# A third human fills adjudicator.json.
pnpm contradiction:labels adjudication-compile pair-study <run-uuid>
```

Files live in `.local/contradiction-labeling/pair-study`. These are claim-text comparisons without external evidence; that empty evidence scope is explicit in the snapshot. Reviewers do not see candidate priority/selection or evaluator predictions. Compilation rejects changed scopes, reviews, missing pairs and reused reviewer/adjudicator ids. Every final decision requires a rationale.

There is intentionally no live provider adapter or automatic UI activation in this prototype. That promotion requires independently adjudicated pair labels and a separately recorded model study: all-pair candidate recall, end-to-end contradiction recall, false alarms, abstentions, critical misses and language/risk slices. A semantic model must not certify its own labels. Existing owner-authored claim relations remain the production feature while this design awaits evidence.

## Verification record

The unit suite tests data tampering/leakage, unchanged reviewer files, no prefilled labels, null denominators, independent held-out gates, critical loss with pending judgments, report/gold tampering, invented occurrences, candidate omissions, exact quote validation, scope mismatch, failed batches without retry, minority preservation and pair adjudication. PostgreSQL fixtures test source binding, fake-mode rejection, receipt presence, prompt drift, extra-context rejection and owner isolation without a network provider.

On 27 September 2026, 148 unit tests and 20 PostgreSQL integration tests passed. Local PostgreSQL initially needed `pnpm db:start`. An incomplete new test fixture exposed a cleanup weakness: cancellation failure could skip deletion of later test rows. Cleanup now continues across cancellation failures, and completed direct-execution fixtures are cancelled before the queue-recovery assertion. Only identified fixtures from the failed attempt were removed. Human review files remain blank and no paid model request was made.
