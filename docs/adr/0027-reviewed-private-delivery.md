# ADR-0027: reviewed bounded private delivery

Status: accepted for local OpenAI-compatible delivery and DA-098 native Anthropic extension, 2 October 2026.

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
