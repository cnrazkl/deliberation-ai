# Providers

## Proposed NVIDIA preset — DA-115, not implemented

Add distinct **NVIDIA API Catalog** identity over the compatible Chat Completions adapter, with `https://integrate.api.nvidia.com/v1`, explicit key/model and self-hosted NIM kept separate. Default reasoning/search off, image support unassumed and prompt-only output until per-model validation. Preserve catalogs, revision binding, usage and unknown outcomes. A manually named custom connection is possible in principle; no NVIDIA generation was tested. [Architecture](KNOWLEDGE_SOURCES.md#nvidia-provider-preset), [official-source research](research/KNOWLEDGE_CONNECTORS_2026_10_05.md#nvidia-hosted-inference).

**DA-100 native private Gemini:** Google joins compatible/Anthropic/Responses delivery using generateContent, header-only credentials and exact reviewed text/order. One text candidate and `generationConfig.maxOutputTokens=1024` are requested without tools, thinking override or council JSON schema. Bounded validation accepts STOP/MAX_TOKENS text only, excludes opaque signatures from retained/future input, preserves candidate/thought/cache/total conventions and maps unfinished candidates to unknown without polling/retry. Earlier private-provider absence notes are historical. Interactions, richer settings and live acceptance remain separate. [Mapping and current official sources](PRIVATE_BRANCHES.md#da-100-native-gemini-generatecontent).

**DA-099 native private Responses:** OpenAI joins Anthropic/compatible delivery with default reasoning/search off. Reviewed text enters `input`, archived assistant turns labelled final; `store/background/stream=false`, `truncation=disabled` and plain text keep the stateless scope. Validate output items/statuses instead of trusting an SDK text shortcut. Opaque empty-summary reasoning is excluded from saved/resubmitted context; visible reasoning/tool/refusal/unknown output fails. Partial text shows truncation; no-text cap failure keeps usage. Queued/in-progress stays unknown without a second request. Inclusive cache/reasoning counts are shown as subsets. Gemini and cloud acceptance remain open. [Mapping and official sources](PRIVATE_BRANCHES.md#da-099-native-openai-responses).

**DA-098 native private text:** Claude/Anthropic joins compatible delivery with default reasoning and search off. The first system turn maps to top-level `system`; remaining turns retain text/order. `/v1/messages`, native auth/version headers and `max_tokens=1024` are used without tools, thinking/effort or retries. Text-only `end_turn`/`max_tokens` results normalize to reply/truncation; other blocks/stops fail with observed usage retained. Claude input/cache conventions remain explicit. Native OpenAI/Gemini private paths and cloud acceptance remain open. [Mapping and primary sources](PRIVATE_BRANCHES.md#da-098-native-claudeanthropic).

**DA-097 private text:** a separate bounded /chat/completions adapter supports only OpenAI-compatible source members with default reasoning and search off. It sends no tools or council structured-output schema, caps output at 1024 tokens (OpenRouter max_completion_tokens; other compatible presets max_tokens), refuses redirects and bounds response bytes. Nullable observed usage is preserved on invalid text when available. Native OpenAI Responses/Anthropic/Gemini private paths and live acceptance remain open.

DA-091 renders `run-continuation-v2` as an explicitly incomplete owner-written summary with source question/provenance and omission metadata. Every independent member and review receives it with an untrusted-context notice. Source archival text remains outside provider work; input estimates and receipt fingerprints include only actual delivery. Full-context descendants do not implicitly restore omitted raw content. Legacy full-context notices/hashes remain unchanged. No SDK endpoint, provider-managed conversation id or live-provider call is introduced. [Scope](CONVERSATION_COMPACTION.md).

DA-090 passes optional frozen historical report text through the existing stateless `FrozenInputSnapshot` and rendered input for initial/review calls. Every adapter receives the same untrusted context via the existing input formatter; provider-operation fingerprints and input-token estimates include it. There is no provider-managed conversation id, SDK capability change or source receipt reuse. Source attachments/memory/tool inputs are not separately retransmitted. Local acceptance uses a loopback mock; live-provider conversation acceptance remains open. [Scope](CONVERSATION_CONTINUATION.md).

DA-084 corrects or voids local owner-reviewed billing evidence without contacting providers or asserting remote refunds. Call/provider/connection/model/response and statement/line identity are preserved. Amount/document changes retain history and leave raw usage/token estimates untouched. [Scope](BILLING_CORRECTIONS.md).

DA-083 records owner-reviewed exact-response billing evidence rather than inferring invoice charges from generation usage or account aggregates. It performs no account/admin endpoint calls. USD component totals, including tools/tax/credits, require complete per-attempt attribution and local receipt matching; actual provider/account/payment reconciliation remains open. [Sources and limitations](PROVIDER_BILLING.md).

DA-082 estimates a declared standard text-token profile with an exact returned model match and complete counting conventions. Inclusive cache/thinking counts are not charged twice. Cache-write TTL, multimodal/context tiers and separate tool fees remain outside the profile. No live rate is hardcoded or fetched. Compatible-endpoint counting bases are operator-declared. [Calculation, references and exclusions](PROVIDER_PRICING.md).

DA-081 adds normalized `ProviderRequest.maxOutputTokens` for a frozen per-call cap. Explicit values must be integers 128–32,768 and are validated before network submission. Mappings are OpenAI `max_output_tokens`, Claude `max_tokens`, Gemini `generationConfig.maxOutputTokens`, OpenRouter `max_completion_tokens`, and other compatible presets `max_tokens`. Undefined retains prior adapter defaults. Requested caps and durable local reservations are distinct from observed usage and remote invoice amounts; custom endpoint enforcement is not attested. Local acceptance verification passed on 1 October 2026. [Verification evidence](REPO_AUDIT_2026_10_01.md). [Sources and limitations](EXECUTION_LIMITS.md).

DA-080 maps only received, valid native usage fields to versioned token detail. It preserves provider counting conventions, does not fabricate missing totals and passes observed metadata through known output-validation failures to durable receipts. SDK/network errors that expose no response retain unknown counts. [Official sources and mappings](PROVIDER_USAGE_DETAILS.md).

All current remote council providers implement the normalized `TextProvider` contract and return raw text plus a validated `ProviderOutput`. Provider-specific request and error types stop at the adapter boundary. Fake providers remain deterministic, offline, and the default for ordinary tests.

The normalized request now permits round 0 plus up to three cross-review rounds. Round 1 retains its original prompt contract; rounds 2–3 include the same frozen previous-round review set for each member and use the cross-review output schema. Every remote attempt retains its own `(run, member, round, attempt)` durable receipt. The additional rounds have not been benchmarked for accuracy, latency or cost.

When self-revision is explicitly enabled, every review round instead uses the versioned `cross-review-v3` output contract. It adds at most five structured proposals tied to the reviewer's own round-0 claim indices. The shared adapter validation preserves review target/stance and revision fields, including for native OpenAI responses. Invalid, duplicate or unlinked proposals fail that review; receipts still prevent blind resubmission. This option has no measured quality or cost benefit.

## Adapter families

| Connection family | Protocol | Typical services |
| --- | --- | --- |
| OpenAI | Native Responses API with Structured Outputs and `store: false` | OpenAI models |
| Anthropic | Native Messages API | Claude models |
| Google | Native Gemini `generateContent` API | Gemini models |
| OpenAI compatible | Chat Completions subset with configurable response format | Kimi, DeepSeek, Qwen Model Studio, vLLM, Ollama, LiteLLM, OpenRouter, custom endpoints |

The compatible adapter requires an explicit base URL. Presets only fill editable defaults; they do not lock a service to a URL or model. DeepSeek uses the official `https://api.deepseek.com` default and current `deepseek-flash` example while remaining on the generic compatible boundary. Qwen keeps the URL empty because Model Studio endpoints are region and workspace specific. Ollama, vLLM, and local LiteLLM connections may omit an API key. Cloud presets require one.

Compatible reasoning models count hidden thinking inside their completion usage. The adapter reserves 4,096 output tokens for general compatible endpoints and 8,192 for Qwen/OpenRouter presets so a low/high reasoning request still has room to emit the required JSON answer. OpenRouter uses the current `max_completion_tokens` field; direct Qwen-compatible endpoints use `max_tokens`. These are request ceilings, not target output lengths.

The worker persists input/output token counts when an adapter receives them in a provider response. DA-058 exposes those stored counters per run, round and attempt without making another provider call. Providers can omit counts, and uncertain or failed requests can still incur charges; no generic field here proves final invoice cost, cached-token pricing or reasoning-token breakdown. The interface keeps absent usage unknown rather than recording zero.

## Connection, model, and task selection

A saved connection is only a reusable credential and endpoint record. Saving it makes no provider request. It may remain idle indefinitely. The connection's model is a starting value, not a permanent binding:

1. Save a native provider or compatible endpoint once.
2. Choose a saved connection for each council member.
3. Enter the exact model id used by that member for this task, then choose its reasoning level and web-search mode.
4. Save the complete member set as a council template when the combination should be reused.

Editing a connection with an empty key preserves its existing encrypted key. A provider family cannot be changed in the edit form. The owner can click **Model listesini kontrol et** for one saved connection. OpenAI uses `GET /models`, Anthropic `GET /v1/models`, Gemini `GET /v1beta/models`, and OpenRouter `GET /models/user`; other compatible endpoints are queried at `<saved base URL>/models`. The response is a bounded list of exact ids, offered as optional task-model suggestions. Gemini entries without `generateContent` are excluded when the catalog advertises supported actions. For LiteLLM the chosen id is the proxy `model_name` alias; for OpenRouter it is the `provider/model` slug. A compatible server must expose `/chat/completions` below the saved base URL for actual generation, but may omit `/models`; in that case manual model entry remains available. Only official native-provider and OpenRouter catalog URLs receive the authenticated-catalog label; a custom or generic compatible reply may be public and does not validate its API key. No list response proves that a specific model can generate with the selected reasoning level or that the account can pay for it.

## Reasoning controls

Each council member stores a normalized level: `default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Each connection declares how that level is transmitted:

- OpenAI native and compatible endpoints may use `reasoning_effort`.
- Anthropic native uses `output_config.effort`.
- Gemini native uses either `thinkingLevel` or `thinkingBudget`; the connection selects the protocol to match the model generation.
- `none` sends no optional reasoning parameter for OpenAI/Anthropic/compatible connections. Gemini budget mode sends zero; Gemini level mode uses its lowest named level.
- A connection with protocol `none` disables the member reasoning selector and sends no reasoning field.

Capability differs by model and provider. The selection belongs to the member snapshot and can change on every task. A model-list response does not establish which reasoning levels a model supports. In particular, the API model `gpt-5-pro` accepts only `high`; its `Pro` name does not mean that a `max` effort value exists. Models whose API documentation includes `max`, such as `gpt-5.6-sol`, may receive that value. The UI prevents the known `gpt-5-pro`/`max` mismatch; any other unsupported selection remains a known provider rejection.

The catalog request shapes follow the official [OpenAI Models API](https://developers.openai.com/api/reference/resources/models), [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list), [Gemini Models API](https://ai.google.dev/api/models), and [OpenRouter user-filtered models API](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails). The generic compatible `/models` probe is best effort because server implementations vary.

DA-066 exposes a narrow projection of those official responses: Claude `display_name`, positive `max_input_tokens`/`max_tokens` and effort entries explicitly marked supported; Gemini `displayName`, positive input/output token limits and an optional `thinking` boolean; OpenRouter `name`, positive `context_length` and whether `supported_parameters` includes a reasoning parameter. OpenAI's list provides model ids but no normalized effort map. Custom URLs and generic compatible replies are not trusted for these metadata fields. Prices, full capability profiles, endpoint routing, tool/schema support and successful generation are not inferred. DA-067 stores only the latest normalized check encrypted with the connection; it survives reload, is invalidated by connection edits, and does not become a historical, versioned per-model capability ledger. The UI retains the chosen reasoning level even if a catalog omits it.

Alibaba Model Studio API keys are region-specific. The current verified local connection uses the Singapore base URL `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` with `qwen3.8-flash`. Current Qwen Chat Completions accepts OpenAI-style `reasoning_effort`; provider aliases such as `high`/`max` may map to the model's highest supported named level. The exact mapping remains provider behavior and is preserved in the immutable member snapshot.

## Provider-native web search

Every member snapshot has an explicit `off` or `auto` web-search mode. `auto` does not mean that every API model already has unrestricted internet access. The adapter adds the provider's native search tool to the request, and the model decides whether the task needs it:

- OpenAI Responses receives `web_search`, automatic tool choice, and a three-call bound.
- Anthropic Messages receives `web_search_20250305` with at most three uses.
- Gemini GenerateContent receives Google Search grounding.
- OpenRouter receives its `openrouter:web_search` server tool with bounded calls and results.
- Kimi, DeepSeek, Qwen, vLLM, Ollama, LiteLLM, and custom compatible endpoints keep this control disabled because they do not share one reliable web-tool contract. They can still be used normally. A LiteLLM deployment may expose provider-specific tools through its own routing, but DeliberationAI does not guess that proxy configuration.

Returned source URLs and titles are normalized as citations, encrypted with the provider result and final report, replayed after a worker restart, and displayed under the member or review that produced them. Citations remain model-supplied provenance, not owner verification. They do not automatically create evidence-source records or change a claim's evidence state.

## Output and failure handling

The native OpenAI and Gemini adapters request a JSON schema response. Anthropic uses the shared JSON prompt contract. Compatible connections choose JSON Schema, JSON object, or prompt-only mode because compatible servers implement different subsets. Every response is parsed again with the shared Zod schema before entering the domain.

When returned text fails that schema, the normalized known error carries the exact raw text as a non-enumerable field. The worker encrypts it on the failed operation receipt and final failed-member record; on restart it replays the failed receipt without another provider call. The owner may inspect the text in the failed analysis or review panel, but it produces no structured claim, citation promotion or successful review. A transport failure with no returned text cannot supply this detail. Native OpenAI retains available output text when its parsed response is missing or invalid; an SDK exception before a response is available has no raw text to retain.

If the owner selected shared-memory entries, adapters receive the same bounded frozen context through the normalized request. It is labeled as potentially stale or unsupported historical context and never as a provider instruction or verified fact. Memory content remains provider-independent and is included in the durable request fingerprint.

Task images remain native image content in round 0. A selected PDF is parsed locally into selectable, page-marked text and enters the normalized user input as untrusted document context for each member whose attachment switch is on. This works across the native and compatible text adapters without relying on each provider's PDF-upload API. Non-consenting members and cross-review receive neither image bytes nor PDF text. Scanned PDFs without selectable text are rejected; no OCR or provider-native PDF processing is implied.

Every network call receives a durable operation id. Native OpenAI uses it as the SDK idempotency key; HTTP adapters send it as a request identifier/idempotency header where accepted. The receipt remains the system-level duplicate-call guard. Network failures and server errors are classified conservatively as unknown outcomes; clear client rejections are known failures. Automatic SDK retries are disabled.

The direct Anthropic, Gemini and OpenAI-compatible HTTP adapters bound the combined fetch and response-body read to ten minutes. A timeout or aborted/read-failed response is `remote_outcome_unknown`: the request may have reached the provider and is not retried automatically. The native OpenAI adapter continues to use the SDK's timeout behavior. Offline tests inject shorter deadlines and stalled fetch/body readers; normal tests never spend provider tokens.

No live provider call belongs to the normal test suite. Adapter tests inject SDK/fetch doubles and assert request translation and normalized parsing.

## Typed decision providers

[ADR-0017](adr/0017-advisory-decision-evaluation.md) defines a separate `DecisionEvaluator` capability for closed-label judgments. Its deterministic fake and direct TypeSafe implementations are available. The TypeSafe adapter calls `POST /v1/systemone` with a frozen state/questions payload, validates the returned choice, class probabilities, confidence, model and usage, disables automatic retries, rejects redirects and moving model aliases, and classifies ambiguous network outcomes conservatively. A Jev model id is never treated as a council member through Chat Completions. OpenRouter decisions still require a separate verified protocol capability and are not implemented. See the API references in the [research assessment](research/JEV_ASSESSMENT.md).

Connection selection distinguishes text generation from typed decisions. A decision connection uses an exact model version such as `jev-1.13.0`, with no invented reasoning or web-search controls. Saving credentials makes no call. Explicit assessment selection and sharing confirmation are separate from council membership, and storing a credential does not imply consent to send source excerpts. Receipts, encrypted storage/replay, response validation, failure normalization, unknown-outcome handling and explicit retry/discard remain separate from `TextProvider`. The feature flag is off by default and normal tests inject fetch doubles. Model/rubric changes require evaluation before reusing calibrated settings.

Reference behavior follows the official [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create), [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search), [GPT-5 Pro](https://developers.openai.com/api/docs/models/gpt-5-pro), [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort), [Anthropic web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [Gemini Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search), [Kimi API](https://platform.kimi.ai/docs/overview), [DeepSeek API](https://api-docs.deepseek.com/), [Qwen OpenAI compatibility](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope), [vLLM server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/), [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility), [LiteLLM proxy](https://docs.litellm.ai/docs/proxy/quick_start), [OpenRouter Chat API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion), and [OpenRouter web search](https://openrouter.ai/docs/guides/features/server-tools/web-search) documentation.
