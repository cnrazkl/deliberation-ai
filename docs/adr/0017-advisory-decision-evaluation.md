# ADR-0017: Optional, non-authoritative decision evaluation

Status: accepted and implemented behind a default-off gate on 21 September 2026; live evaluation was owner-deferred and is not an active milestone requirement. JEV advisory adoption remains locked unless a future evaluation passes.

## Context

The owner prioritizes accuracy over latency or cost and requested an assessment of Jev. The [research assessment](../research/JEV_ASSESSMENT.md) finds a plausible source-support classification use case but no demonstrated benefit on this project's Turkish workload. Typed decisions are not generative council output, and valid output does not establish truth.

## Decision

Preserve the modular monolith, independent council rounds, deterministic grouping, minority claims, and owner-controlled evidence and synthesis annotations. Add a provider-independent `DecisionEvaluator` port, separate from `TextProvider`. JEV is its first experimental candidate, not a required infrastructure dependency or council member.

The first task is a single claim against an explicitly selected, immutable source excerpt. The mutually exclusive labels are `supports`, `contradicts`, `insufficient_evidence`, and `not_applicable`. Full definitions and quality gates live in [EVALUATION](../EVALUATION.md). This measures what the excerpt states, not source credibility, currency, or world truth. Conflicting/partial support must not become a positive verification.

Execution modes are `off` (default, no call), `shadow` (explicitly enabled, stored evaluation without influencing the council or evidence workflow), and `advisory` (conditional on the quality gate, visible review suggestions). Automatic verification, suppression, claim merging, research skipping, model routing, and reductions in reasoning effort are excluded. An unflagged claim is not a passed check.

## Boundaries and lifecycle

- Run analysis/review and persist the report normally. Only afterward may the owner initiate a separate bounded assessment of selected claim/source pairs. This does not delay, reopen, or change the council run's terminal status.
- Freeze the exact claim, source excerpt and dates, input report revision, rubric/options, provider connection configuration, requested model, and evaluation settings. Existing provider/model capabilities do not imply decision capability.
- Missing excerpts, exceeded limits, invalid outputs, or provider errors yield `not_assessed` with a reason, never `supports`. Preserve the distinction from a valid `insufficient_evidence` prediction. Do not silently truncate or fetch a URL as fallback.
- Store full class probabilities, optional provider confidence with its definition, returned model version, usage, and immutable input provenance. Do not manufacture a natural-language explanation that the decision model did not produce. Show the original excerpt for inspection.
- Add separate `decision_assessments` and `decision_operations` persistence contracts. Never disguise a decision as `ProviderOutput`, a council member, or round 2. Operation uniqueness is `(assessmentId, batchId, attempt)`; a fingerprint covers protocol/endpoint configuration, input versions, exact rubric/options and ordering, model, and settings, excluding secret values. Record returned model versions separately.
- Short transactions persist assessment state and enqueue its own job atomically. Network work remains outside transactions. Receipts record prepared/submitted/success/known failure/unknown outcomes, replay encrypted successes, and block blind retry. Explicit retry/discard acts on the assessment only and preserves earlier attempts. Do not assume remote idempotency support.
- Completion checks cancellation and input versions before publishing suggestions. Keep prior results as history and label an outdated projection for reassessment; never apply old results to a revised claim/source/review state. Assessment failure does not downgrade a completed council run.
- Existing source records currently stay local. This new boundary requires an explicit selection of excerpts and a decision connection, with disclosure of the destination. Default remains off; no global automatic export of the evidence library.

## Provider strategy

Implement a deterministic fake and frozen rubric first, then an isolated TypeSafe decision adapter with disabled automatic retries. Treat OpenRouter's decision interface as a separate, experimental adapter capability; its chat interface does not establish compatibility. Pin tested model/rubric versions, re-evaluate changes, and validate provider outputs at the adapter boundary. Reasoning and web-search controls remain unavailable for decision models unless their actual contracts support them.

## Consequences

The implementation adds a deterministic fake, an injected direct TypeSafe adapter, encrypted decision connections/assessments/operations, a dedicated worker queue, explicit data-sharing confirmation, and a shadow result panel. It remains disabled by default and avoids coupling the council to one vendor. The owner deferred live calls; no accuracy benefit is claimed and the completed local council has no dependency on this path. Advisory promotion or any automated action based on these assessments requires new evidence and a separate accepted decision.
