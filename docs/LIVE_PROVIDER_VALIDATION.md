# Live provider validation

Date: 21 September 2026

This is an opt-in local smoke test of the configured provider adapters. It is not a model-quality benchmark. Every run used the same short Turkish canary-release question, two independent council members, no shared memory, and no cross-review. Credentials were entered through the local encrypted connection form and are not recorded in this document.

## Results

| Connection | Model | Tested reasoning | Result | Representative receipt |
| --- | --- | --- | --- | --- |
| OpenAI native | `gpt-5.6-luna` | `low`, `max` | Passed | `c6dda722-c632-412d-bf46-65e6bcf8ff28`: 277 input / 466 output tokens at `max` |
| Google native | `gemini-3.8-flash` | `low`, `high` | Passed | `c6dda722-c632-412d-bf46-65e6bcf8ff28`: 195 input / 196 output tokens at `high` |
| Anthropic native | `claude-sonnet-5` | `low`, `high` | Passed | `d009e0b0-b290-4598-b668-64759715de3c`: 383 input / 947 output tokens at `high` |
| DeepSeek compatible | `deepseek-flash` | `low`, `high`, `max` | Passed | `d009e0b0-b290-4598-b668-64759715de3c`: 341 input / 1,719 output tokens at `max` |
| OpenRouter compatible | `qwen/qwen3.5-35b-a3b` | `low`, `high` | Passed after output-budget correction | `a8a9d631-9f61-456d-8473-7e2f1994d942`: 218 input / 2,764 output tokens at `high` |
| Alibaba Model Studio compatible | `qwen3.8-flash` on Singapore | `low`, `high` | Passed | `8698cae4-4b44-4a45-ae0f-20d0742427c3`: 258 input / 635 output tokens at `high` |
| Moonshot Kimi compatible | `kimi-k2.6` | `low` attempted | Account blocked | API returned `exceeded_current_quota_error`: the account is suspended for insufficient balance |

The first OpenRouter Qwen attempts exhausted a 2,000/4,096-token completion cap entirely on reasoning and returned no JSON answer. The compatible adapter now reserves 8,192 completion tokens for OpenRouter and Qwen presets. The successful low and high receipts above prove that the final structured answer is preserved while the selected reasoning effort still reaches the provider.

The first Alibaba credential was rejected on every regional and plan endpoint. The replacement workspace key was accepted by the Singapore catalog. The saved connection now uses `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` and the current `qwen3.8-flash` model. Low and high requests both completed, and the increased output-token use at high is consistent with the provider accepting the reasoning control. This observation does not by itself measure answer quality.

## Provider-native web search

The live search smoke test used explicit `webSearchMode=auto` snapshots:

| Path | Result | Evidence |
| --- | --- | --- |
| OpenAI native search | Passed | `adfb7276-30ee-4f49-bc78-0ee457084c98` returned 11 normalized citation URLs |
| Gemini Google Search grounding | Request passed; no citation returned | The provider accepted and completed the grounded request, but this response contained no extractable grounding URL |
| Anthropic native search | Passed | `7e0ff9da-2ac3-4e4c-81f4-f1424732811c` returned 9 normalized citation URLs |
| OpenRouter search tool | Passed | `7e0ff9da-2ac3-4e4c-81f4-f1424732811c` returned 5 normalized citation URLs |

Provider-returned citations remain provenance only. They do not become verified evidence, change claim status, or enter synthesis automatically.

## Interpretation

- The live request path, encrypted connection lookup, provider-specific reasoning translation, durable operation receipts, token accounting, JSON validation, and report persistence work for six paid endpoints.
- `max` is a normalized UI choice, not a promise that every model has a distinct maximum tier. Provider adapters apply their documented mapping; for example, Gemini and current Qwen models map unsupported aliases to their highest accepted level.
- Kimi requires an account balance change before a successful generation test. The 429 response is an external billing state rather than an adapter or credential-format failure.
- These short smoke tests show protocol compatibility. They do not establish factual accuracy, comparative quality, or a best model for every task.

