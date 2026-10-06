# NVIDIA hosted preset — DA-125

The connection editor offers **NVIDIA hosted** as a distinct service identity over
the existing `openai-compatible` protocol. It fixes the base URL to
`https://integrate.api.nvidia.com/v1`, requires an explicit NVIDIA credential and
exact model identifier, and fixes reasoning protocol to `none` and structured
output mode to `prompt-only`. Switching to or from this preset requires a new key;
the previous service's encrypted credential cannot be silently reused. Self-hosted
NIM belongs to the custom preset and is outside this hosted identity.

The optional, explicit catalog action probes `/models`. A successful list is
`catalog_only`, does not establish key/model access, and supplies no inferred
context window, reasoning, image or schema capability. Unsupported catalogs and
authentication failures do not remove manual model entry. The model chosen for a
council task remains explicit and independent of the connection's default model.
Catalog results are encrypted and accepted only for the checked connection revision.

Council generation sends system/user text and `max_tokens` to
`/chat/completions`. Local document excerpts can be included as text; image input,
explicit reasoning overrides and provider-managed web search are unsupported.
There is no `response_format`, thinking override or tool request. The prompt asks
for the existing council JSON contract, which is validated locally. Invalid output
retains raw text and available usage. Private delivery uses its separate reviewed
plain-text contract and output allowance. Missing usage stays unknown; counters do
not establish invoiced cost or savings. Model-specific output limits and real
schema reliability still require live acceptance.

At enqueue, the owned NVIDIA connection revision is locked and copied into the
encrypted member snapshot as optional `nvidiaConnectionRevision`. The worker
refuses an edited/deleted/switched connection, or an unbound run that now points
to NVIDIA, before constructing a submitted provider operation. This fence binds
queued execution, not a new connection-specific preview contract. The worker uses
the loaded immutable settings throughout execution; an edit after settings are
loaded cannot recall an already executing run. Copied/rerun NVIDIA members retain
the original revision; after a connection edit, start a newly reviewed task.
Private delivery already binds exact connection fingerprints through preview and
dispatch. Historical non-NVIDIA snapshots need no conversion. No SQL migration is
added.

Hosted redirects are refused. HTTP 202 pending and network/5xx uncertainty normalize
to an unknown remote outcome and do not trigger blind resubmission. Existing durable
receipt/operator reconciliation rules apply. No NVIDIA request-id polling or
remote-result retrieval is implemented; an idempotency header does not prove
NVIDIA-side deduplication. A real key, model access and hosted end-to-end generation
were not exercised by this increment. Live calls remain explicitly opt-in.

Primary sources checked on 6 October 2026:

- [NVIDIA LLM API index](https://docs.api.nvidia.com/nim/reference/llm-apis)
  identifies hosted Chat Completions and separates downloadable NIM.
- [NVIDIA hosted Llama reference](https://docs.api.nvidia.com/nim/reference/meta-llama-3_1-70b-infer)
  documents the hosted endpoint, exact model id, model-specific `max_tokens` and
  200/202 response boundaries. Its per-model limits are not generalized to the catalog.

Verification is recorded in [DA125_ACCEPTANCE.md](DA125_ACCEPTANCE.md).
