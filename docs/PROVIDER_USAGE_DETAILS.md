# Provider token detail visibility (DA-080)

DA-081 adds a separate optional local dispatch-capacity display: submitted generation attempts, permanently reserved output capacity and remaining allowance. These values are not measured provider consumption and never replace unavailable actual counts. Local acceptance verification passed on 1 October 2026. [Verification evidence](REPO_AUDIT_2026_10_01.md). [Execution limits and exclusions](EXECUTION_LIMITS.md).

The saved-run usage panel now shows provider-reported total, cache-read, cache-write, reasoning and tool-input token counts when the response contains them. Each subtotal has its own reported-attempt denominator. Missing remains unavailable; a reported zero is a real zero. These observations are neither invoice amounts nor an enforced budget.

Native input/output counts keep their meaning, including in historical receipts. A separate `provider-token-details-v1` contract is stored inside the existing encrypted result-metadata envelope. No migration or historical rewrite is needed. Historical detail counts cannot be reconstructed from current settings.

| Adapter | Native input/output | Additional observed fields |
|---|---|---|
| OpenAI Responses | `input_tokens` / `output_tokens` | `total_tokens`, input `cached_tokens` / `cache_write_tokens` when supplied, output `reasoning_tokens` |
| Claude Messages | `input_tokens` excludes cache reads/writes; `output_tokens` is inclusive | `cache_read_input_tokens`, `cache_creation_input_tokens`, output `thinking_tokens` when supplied; no invented provider total |
| Gemini generateContent | `promptTokenCount` includes cached input; `candidatesTokenCount` counts response candidates | `totalTokenCount`, `cachedContentTokenCount`, `thoughtsTokenCount`, `toolUsePromptTokenCount` |
| Compatible Chat Completions | `prompt_tokens` / `completion_tokens`; meaning is endpoint-defined | `total_tokens`, prompt `cached_tokens` / `cache_write_tokens`, completion `reasoning_tokens` if present |

The display never adds these fields together: cache and reasoning counts may already belong to another count. Gemini thoughts are separate from candidates; Claude cache input is separate from native input. Cross-provider sums refer only to the specifically named native fields, not normalized billing usage. Tool-input tokens are not search-request counts or charges. DA-081 introduces verified requested-output reservations; cache TTL, modality/tier/tool billing, prices, complete input-token budgets and monetary reservations remain open.

Adapters exclude invalid optional counters (negative, fractional, string, nonfinite or outside the stored integer range) without rejecting a valid answer. A returned response rejected by council JSON validation preserves observed usage and the remote response id on its encrypted failed receipt. Failure replay never authorizes another request. Network failures and SDK errors that do not expose a received response retain unknown usage.

The owner-scoped usage route uses one repeatable-read snapshot for totals and attempts. It decrypts only result metadata in pages of 100, projects the strict count/convention allow-list and displays at most the newest 100 operations. Aggregates include every attempt, including failed and older ones. Prompts, raw responses, citations, credentials and full metadata are excluded from the DTO.

Primary references checked on 29 September 2026: [OpenAI Responses usage](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), [OpenAI output-token counting](https://developers.openai.com/api/docs/guides/token-counting), [Claude Messages usage](https://platform.claude.com/docs/en/api/typescript/messages), [Claude cache accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), and [Gemini UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata). Compatible servers can differ; unsupported fields stay unknown.
