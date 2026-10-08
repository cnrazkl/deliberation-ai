# Reviewed synthesis — Group 3

8 October 2026. `reviewed-synthesis-v2` implements an opt-in local command for
source-linked free-form drafts. It is separate from council execution and is not
an automatic final answer, evidence promotion, chair or accuracy certification.
The owner deferred Group 1 human review and selected this Group 3 engineering work.

## Input and outcome

The operator selects a terminal owned run and two saved connections. The proposer
and reviewer must have different normalized endpoint/model identities. Aliases can
still name the same backend; this check does not authenticate model independence.
Only the question, complete claim ledger, scope/evidence/coverage annotations,
occurrence identifiers/quotes, owner relations and parsed reviews enter the request.
Raw member replies, labels, credentials, attachments, source files and source URLs
are excluded. The semantic check measures fidelity to supplied claims; it cannot
establish truth or entailment from external source documents that were not sent.

All claims must be linked in the draft, including minority/red-team/omitted claims.
No invented or duplicate paragraph claim references are allowed. The separate
reviewer checks every paragraph and returns a source/draft-bound judgment with an
exact quote from every cited claim. Changed entity/time/conditions, unsupported
assertions and strengthened certainty require rejection or uncertainty.
Malformed, missing, stale or non-verbatim checks refuse the draft.

At most one proposer repair is allowed after a known returned invalid draft or
valid negative semantic judgment. The repaired draft is reviewed again. Network
uncertainty, provider rejection, malformed reviewer output, incomplete responses,
reported output above the requested cap, stale inputs or local storage failure
return the deterministic complete claim ledger without another attempt.
An accepted draft is labelled `model_reviewed_candidate`,
`semanticValidation=model_judgment_only`, `humanAcceptance=not_assessed`.
Rejected drafts and model judgments remain inspectable in encrypted artifacts.
The original report, evidence, coverage, completion and review rounds are not edited.

The model input is bounded to 12 claims and 12,000 source JSON characters; oversized,
broken or high-risk-control-incomplete reports use the full deterministic ledger.
There are at most four calls, 4,096 requested output tokens per call and a sixty-second
request/body deadline. Repairs also have a 30,000-character complete request limit.
Reported tokens remain observations. Missing counters and invoice cost stay unknown;
requested output caps are not hard input/tool/money reservations or account limits.

## Local operation

```powershell
pnpm synthesis prepare study-name <run-uuid> <proposer-connection-uuid> <reviewer-connection-uuid>
# Inspect .local/reviewed-synthesis/study-name/preview.md before sharing.
pnpm synthesis run study-name --live <printed-fingerprint>
pnpm synthesis status study-name
pnpm synthesis export study-name
```

`prepare-sample` instead of `prepare` omits the run UUID and uses the fixed synthetic
three-claim valve fixture. It carries no owner conversation or independent gold.
Preparation and status make no provider request. The live flag and exact fingerprint
confirm the bounded sharing plan. The preview includes exact source data and both
fixed system instructions; future model-produced draft/repair data cannot be known
before execution. Connections and owned source are revalidated before and after
every network attempt. Changed/deleted input blocks subsequent work. Already sent
text cannot be recalled; receipts preserve the frozen historical attempt.

The existing native OpenAI/Anthropic/Gemini and compatible bounded text transports
are reused with two system/user messages, no tools, redirect refusal and no retries.
Native normalization and private chat behavior remain covered by regressions.
Synthesis compatible replies additionally require one assistant choice, text only
and a recognized completion reason. No provider SDK value enters the domain.

`.local/reviewed-synthesis/<study>/` contains context-bound AES-GCM plan, execution,
submitted/returned phase receipts and final result files. Exclusive creation and
file flush precede outbound calls; overlapping executions cannot own one identity.
Existing terminal results replay without calls. Interrupted executions are not
resubmitted or resumed automatically, even if the crash preceded the first request.
Unreadable artifacts fail closed. No error, prompt or raw answer is printed.
`preview.md` and the explicit `result.md` export are plaintext local copies; they
are ignored by Git, retained independently and never overwritten. These sidecars
are outside database backup/retention and must be protected or removed separately.
There is no browser synthesis button or new database migration in this increment.

## Acceptance boundary

This closes the engineering path for generation, a separate model fidelity review,
one repair, durable local receipts and deterministic fallback. It does not close
Group 3's independent semantic quality acceptance, early-stop study, 0/1/2/3-round
accuracy/latency comparison or settled monetary/input/tool guardrail.
Group 1 remains deferred with human judgments unfilled. No synthetic decisions
can become independent labels or a quality pass.

Before live verification the fixed diagnostic is one Qwen proposer and one Anthropic
reviewer on the synthetic three-claim fixture, at most four calls and no automatic
retry. This is transport/control-flow evidence only. All failure outcomes, usage and
repair count will be retained rather than selecting a favorable result.

## Verification

The first fixed Qwen/Anthropic diagnostic returned one Qwen draft: 636 input and
1,520 output tokens reported despite the requested 1,024. The candidate was refused
with `generation_incomplete_or_cap_exceeded`; no reviewer, repair or retry ran.
The encrypted receipt and complete ledger fallback are retained.

Before the next call, a separately identified diagnostic selects Anthropic as
proposer and native OpenAI as reviewer, using the unchanged synthetic fixture,
the same version/caps and at most four calls. It exercises the other native paths;
it does not replace the initial failed outcome or claim a model-quality result.

That second diagnostic returned a known invalid Anthropic plain-text envelope,
933 input / 428 output tokens reported. It stopped after one call with no repair,
reviewer or retry. Original provider error bodies are never logged. Invalid-envelope
visible text is now retained when safely extractable in later encrypted receipts;
opaque reasoning/wire envelopes remain excluded.

Before a third separately identified diagnostic, native OpenAI is selected as
proposer and DeepSeek compatible as reviewer, using the same fixture/version/caps
and at most four calls. All three diagnostic outcomes remain in the evidence.

The third v1 diagnostic returned a valid OpenAI draft (560 input / 256 output
tokens) but the DeepSeek review failed its text contract (959 input / 1,024 output
tokens), so the ledger fallback remained. No repair or retry followed.

Before further execution, v2 separates synthesis from the private-chat ceiling:
the fixed requested output cap becomes 4,096 and is included in source/approval
fingerprints. Existing 128–1,024 private-chat limits stay unchanged. Old v1 plans
cannot execute under v2 and all three original outcomes remain historical failures.
The final diagnostic preselects native OpenAI proposer and Qwen compatible reviewer
on the unchanged synthetic fixture with at most four calls under v2. This addresses
the observed output-budget limitation without accepting incomplete v1 outputs or
claiming that providers enforce requested caps.

The fourth diagnostic returned a valid native OpenAI draft (563 input / 208 output
tokens) and a Qwen review (911 input / 1,836 output tokens). The review rationale
exceeded the fixed 400-character contract; the terminal result is review_invalid
with a complete ledger fallback, two calls and no repair/retry. The limit stays
unchanged; both prompts now explicitly state their existing string/array bounds.
Risk-control and eligibility changes are included in frozen source fingerprints.
Historical terminal receipts remain immutable and are never reclassified.

A separately identified final diagnostic uses the same OpenAI/Qwen pairing,
unchanged synthetic claims and 4,096 cap with explicit rationale bounds. Its result
will be retained alongside every earlier outcome; it cannot certify semantic quality.

That fifth diagnostic returned a valid OpenAI draft (590 input / 243 output tokens)
and a schema-valid Qwen review (978 input / 2,541 output tokens), but its echoed
draft digest did not match. Exact source and quotation checks passed; the draft
binding did not. It stopped after two calls with `review_invalid`, no repair/retry
and a complete fallback. The prompts now explicitly require copying supplied
digests, rather than calculating or rewriting them. This final clarification is
covered offline and has not been sent in another paid test. Across all five
diagnostics there were eight calls and no accepted hosted synthesis candidate.
This is a recorded interoperability limitation, not a semantic acceptance result.

Final terminal replay returned the same result with unchanged artifact hashes and
no provider call. Markdown export succeeded once; replacement was refused.
446 offline unit cases/76 files, workspace/scripts typechecking, zero-warning lint,
separate-output Next.js 16.3.8 production build, frozen installation, seven lint
compatibility cases and dependency audit pass. Three read-only browser diagnostics
cases passed against the patched runtime. Live calls remain opt-in and outside CI.
