# ADR-0027: reviewed bounded private delivery

Status: accepted for local OpenAI-compatible delivery, DA-098 native Anthropic, DA-099 native OpenAI Responses and DA-100 native Gemini extensions, 2 October 2026.

Extend the DA-096 encrypted private aggregate rather than feed private messages into
canonical council state. Freeze actual plain-text messages in an owned preview-bound
receipt and atomically enqueue a separate pg-boss job. Fence execution with a session
lock and persist submission before network work. Recovery of submitted work records
uncertainty; it cannot spend another provider request on a guessed retry.

Initially support only compatible endpoints with default reasoning, web search off and
standard-risk input. Require exact-input review and claim-time connection revision checks.
Keep observed usage separate from council billing. Restrict permanent requests and output
capacity, without representing those limits as a monetary budget. Preserve copied reply
origins across version-bound forks and source retention. Reuse authenticated private-body
backup/export checks; add no plaintext columns or migration.

Consequences: private input is an incomplete selected perspective, not the original
provider conversation or verified facts. Broader provider support, in-flight cancellation,
shared accounting and private-content/backup/export erasure require separate increments.

DA-098 extends the same boundary to native Anthropic Messages: move only the leading
system instruction to the native field, preserve remaining text/order, admit only
bounded text-only native stops and expose uncached/cache token conventions. Provider
identity must match the frozen source at preview and claim; resolve an absent native
base URL to the official root. No council/schema/receipt-version changes are needed.
Native OpenAI/Gemini, broader settings and cloud/model-quality acceptance stay open.

DA-099 adds native Responses with stateless reviewed text and reconstructed final
assistant phases. Disable response storage/background/streaming/automatic truncation,
validate all output items and preserve unknown pending outcomes without retrieval or
retry. Exclude opaque reasoning state from saved/future context; visible reasoning is
unsupported. Explain that output caps include reasoning and expose native counters as
inclusive subsets. Gemini and richer settings/continuation remain separate increments.

DA-100 extends the boundary to Gemini generateContent using exact stateless user/model
text and a separate leading systemInstruction. Request one text candidate with the
existing cap, no tools or thinking override; validate STOP/MAX_TOKENS and strict text
parts. Opaque signatures are discarded, not replayed or represented as reasoning
continuity. Candidate-output, thought and total counters retain native meanings.
Unfinished candidates stay unknown; textless cap failures retain observed usage without
resubmission. No schema/council/receipt-version change; richer settings, Interactions,
private erasure/accounting and cloud/model-quality acceptance remain open. Earlier
provider absence/next statements record historical scope.
