# Council execution limits (DA-081)

Status: local acceptance verified on 1 October 2026. [The repository audit](REPO_AUDIT_2026_10_01.md) records this increment's own checks and fixes. No live paid-provider result is claimed here.

8 October scope decision: the owner cancelled the planned input/tool-token budget
accounting and monetary spending protection extension. Existing local call/output
controls remain implemented; cancellation does not establish the excluded ceilings.

The owner can optionally freeze `dispatch-limits-v1` controls for a council: the maximum number of submitted generation attempts, an output-token cap per attempt, and the total output capacity the application may reserve. These controls limit application dispatch. They are separate from provider-reported actual usage and do not establish a monetary or total-input-token ceiling.

| Field | Allowed integer range | Meaning |
| --- | --- | --- |
| `maxProviderCalls` | 1–100 | Maximum newly submitted council generation attempts in this run |
| `maxOutputTokensPerCall` | 128–32,768 | Output cap sent with each new generation request |
| `maxReservedOutputTokens` | 128–3,276,800 | Cumulative output capacity reserved before submission |

Limits must cover the configured planned council: `member count × (1 + review rounds)` calls and that count multiplied by the per-call output cap. A selected-member follow-up instead plans `1 + member count × review rounds` fresh calls. Extra capacity can allow an explicitly authorized retry. A low output cap can truncate reasoning or JSON and cause a failed or partial result; it is not an accuracy optimization.

## Frozen scope

Run and local-schedule limits are encrypted with record-specific authenticated context. A resumed pending-context draft retains the chosen limits. Each scheduled occurrence receives its own frozen limits and reservations; there is no account-wide or schedule-lifetime cumulative spending limit. An idempotent replay returns the same run rather than another budget.

A selected-member follow-up inherits its source configuration but creates a fresh child-run allowance. Copied round-0 results consume no new reservations. The selected member's fresh round-0 call and every fresh review do. A child allowance does not refund, alter or share its parent's reservations. Run limits remain fixed after enqueue; changing an allowance requires a new reviewed run. Existing runs and schedules without limits retain their prior behavior and are explicitly unbounded by this policy.

## Durable reservation

The persistence boundary checks the frozen allowance and permanently records the per-attempt output reservation in the same transaction that claims `prepared → submitted`. An owned run-row lock serializes parallel claims. Both call count and cumulative output capacity must fit before any delegate contacts a provider; an exhausted allowance is a known local failure and does not authorize a request.

One submission reserves its full per-call output cap. The reservation is never reduced to reported usage, even if the provider reports fewer tokens, returns an HTTP error, produces invalid JSON, or the application loses the result. Submitted and `outcome_unknown` attempts cannot be retried automatically. Operator discard closes uncertainty without restoring capacity. Explicit retry authorization preserves the prior reservation, and a new attempt must fit and consume a new one. A successful receipt replays its encrypted result without a new call or reservation. A worker restart does not reset reservations.

This conservative ledger can exhaust while observed usage remains below its capacity. Keeping reservations permanent avoids converting missing or ambiguous provider usage into invented zero consumption. It is not a settled invoice-cost ledger.

## Provider mapping and display

| Adapter | Request cap |
| --- | --- |
| OpenAI Responses | `max_output_tokens` |
| Claude Messages | `max_tokens` |
| Gemini generateContent | `generationConfig.maxOutputTokens` |
| OpenRouter compatible preset | `max_completion_tokens` |
| Other compatible presets | `max_tokens` |

The normalized request carries and fingerprints the chosen cap. All four adapter families reject a noninteger or out-of-range explicit cap before a network call. An absent cap preserves historical adapter defaults, including Gemini's omitted field. OpenAI and Claude document thinking inside the output cap; Gemini documents the combined thought/response cutoff. A custom-compatible endpoint's behavior is not established by its preset or by these offline tests. See [OpenAI output counts](https://developers.openai.com/api/docs/guides/token-counting), [Claude thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), and [Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking), checked 29 September 2026.

The usage panel shows submitted attempts, reserved capacity and remaining local allowance separately from [actual reported token fields](PROVIDER_USAGE_DETAILS.md). Missing actual counts remain unavailable. These limits exclude input tokens, provider web-search/tool charges, MCP invocations, retrieval and the separate default-off decision evaluator. They cannot guarantee that a remote service honors a parameter or prevent unrelated requests made outside this application.

## Verification and remaining work

Acceptance passed concurrent claims, reconnect/replay, unknown outcomes, discard/retry without refunds, frozen draft/schedule/follow-up behavior, denied requests making no delegate call, usage display and all adapter cap mappings. Database checks used isolated generated fixtures. The full final-version browser run passed 11 flows; the corrected follow-up/quota file passed both flows, completing coverage of all 12. Verification also passed 206 unit tests, 46 PostgreSQL integration tests, type checking, lint and production build. No paid request was made.

The backup inventory includes `runs.execution_limits_ciphertext` and `local_schedules.execution_limits_ciphertext`; `provider_operations.reserved_output_tokens` is searchable non-sensitive reservation metadata. Migration `0033_light_warbound.sql` is applied locally. A fresh disposable restore verified 280 runs, 4,800 encrypted rows and 7,329 decrypted values, including both quota fields populated by a generated cancelled-run and paused-schedule fixture. Those fixtures created no jobs or model calls and were removed from the live database afterward. Wrong-context ciphertext regression checks fail for either field. This is encrypted-field readability verification, not replacement cutover acceptance.

The broad input/modality/tool budget and monetary enforcement extension is cancelled
by the owner's 8 October instruction. Provider-authoritative invoice/account/payment
acceptance was separately cancelled for now. Existing versioned price observations
and local billing evidence remain inspectable without certifying settled cost or
monetary enforcement. Independent semantic synthesis and human/model quality
acceptance remain open.
