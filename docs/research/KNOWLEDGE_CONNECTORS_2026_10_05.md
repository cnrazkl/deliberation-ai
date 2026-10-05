# Knowledge connector and NVIDIA research

Reviewed: 5 October 2026. Public documentation/repositories only; no installation, account access, file upload or inference test. Repository descriptions establish candidate capabilities, not measured reliability. Recheck versions and contracts during DA-111/115. Product pages currently use both NotebookLM and Gemini Notebook names; adapter identity must not depend on marketing names.

## Revised decision after owner's reliability requirement

Security of the service, reliability of its integration and truth of a retrieved passage are separate questions. This review does not find NotebookLM or Notion intrinsically unsafe. It excludes brittle integration mechanisms and declines to certify untested alternatives. Current implementation priority is the bounded local library described in [the architecture](../KNOWLEDGE_SOURCES.md#minimal-local-baseline-and-sustainable-operation); it still needs implementation and acceptance.

The earlier proposal to experiment with NotebookLM cookie bridges is withdrawn. Official Google [notebook-management documentation](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks) explicitly labels the API Preview/Pre-GA. The inspected management/source pages do not establish a supported question-to-raw-citation retrieval contract. Therefore official NotebookLM stays deferred, conditional on capability, maturity, scope and operating-cost acceptance rather than on brand reputation.

## Candidate comparison

| Candidate | Evidence from primary sources | Assessment for this project |
| --- | --- | --- |
| NotebookLM / Gemini Notebook community bridge | [jacob-bd notebooklm-mcp-cli](https://github.com/jacob-bd/notebooklm-mcp-cli) warns about undocumented internal APIs and browser cookies. | Excluded from the supported roadmap, including the proposed experiment. A dedicated account does not repair the unsupported API dependency. |
| Alternate NotebookLM bridge | [PleasePrompto/notebooklm-mcp](https://github.com/PleasePrompto/notebooklm-mcp) describes browser-backed queries and Streamable HTTP. | Excluded: transport compatibility does not remove browser/session fragility. No reliance on its quality marketing. |
| Official enterprise API | Google's [notebook management](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks) and [source management](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks-sources) cover notebooks and source upload. | Deferred, not admitted: management API is Preview; required retrieval contract and easy operational fit are unverified. Reconsider when the full gate is met. |
| Open Notebook | [Repository](https://github.com/lfnovo/open-notebook) supplies a self-hostable notebook application; [API](https://raw.githubusercontent.com/lfnovo/open-notebook/main/docs/7-DEVELOPMENT/api-reference.md) and [search](https://raw.githubusercontent.com/lfnovo/open-notebook/main/docs/3-USER-GUIDE/search.md) document integration. | Conditional candidate only; no “safe default” designation. Shared-password scope and all-notebook fallback require an isolated instance and gateway enforcement. Direct API preferred if accepted. |
| RAGFlow | Maintainer docs describe [using RAGFlow as an MCP server](https://github.com/infiniflow/ragflow/blob/main/docs/develop/mcp/use_ragflow_as_mcp_server.md) and [launch modes](https://github.com/infiniflow/ragflow/blob/main/docs/develop/mcp/launch_mcp_server.md). | Candidate when retrieval/document control matters more than notebook UX. Tenant access is broader than an individual selected dataset; enforce explicit dataset mapping. Verify actual transport: older HTTP+SSE documentation is not proof of Streamable HTTP compatibility. Infrastructure burden needs a local trial. |
| Notion | Official [files/media documentation](https://developers.notion.com/guides/data-apis/working-with-files-and-media) supports PDF; [capabilities](https://developers.notion.com/reference/capabilities) describe access controls and child-page access. | Excluded from this program for scope/fit, not condemned as unsafe. No demonstrated complete PDF retrieval/citation contract; adding an archive dependency does not solve the core need. |

The recommendation is architectural inference from these contracts and this project's constraints. No benchmark or security audit of these projects was performed. Open source applies to the bridges or alternative applications; it does not make Google's hosted NotebookLM service open source or eliminate external inference costs.

## NVIDIA hosted inference

NVIDIA's [LLM API catalog](https://docs.api.nvidia.com/nim/reference/llm-apis) and [hosted Chat Completions reference](https://docs.api.nvidia.com/nim/reference/openai-gpt-oss-120b-infer) establish the hosted `/v1/chat/completions` path and model-specific request contract. The proposed base URL is `https://integrate.api.nvidia.com/v1`. This supports reusing DeliberationAI's compatible adapter, subject to actual output-contract acceptance.

[Self-hosted NIM API documentation](https://docs.nvidia.com/nim/large-language-models/1.12.0/api-reference.html) describes deployment-specific endpoints; do not extrapolate its Responses API, tools or model capabilities to every hosted catalog model. Model availability, pricing, quotas, reasoning and image/structured-output behavior must be checked for the selected endpoint/model. API-key possession or a model list is not successful-generation evidence.

## Open Notebook findings that change the recommendation

The [API reference](https://raw.githubusercontent.com/lfnovo/open-notebook/main/docs/7-DEVELOPMENT/api-reference.md) states that auth is disabled when no password is configured and otherwise uses one shared password, not user accounts. Its [search guide](https://raw.githubusercontent.com/lfnovo/open-notebook/main/docs/3-USER-GUIDE/search.md) says an empty notebook selection searches the entire library, text stemming is English-only, and Ask is beta and sees embedded content only. These are concrete conditions to test, not proof of an exploitable vulnerability. In DeliberationAI an empty grant must instead return no data and make no backend call.

The project's [security document](https://raw.githubusercontent.com/lfnovo/open-notebook/main/docs/7-DEVELOPMENT/security.md) is an additional review input. A supported deployment must pin code and its live OpenAPI schema, require auth, prevent direct backend exposure, isolate approved data and test scope on source reads as well as search. Acceptance also needs Turkish retrieval/negative-answer tests and an upgrade/restore rehearsal. No such deployment or test has been performed here.

## Selection experiment

First validate the local canonical source store, bounded retrieval and exact citations without an external notebook dependency. Optionally compare an isolated Open Notebook or RAGFlow deployment through documented APIs with the same non-sensitive corpus. Record pinned versions/schema, license, effective auth scope, transport, side effects, deadlines, source locators, backup/upgrade/exit procedures, operator work and costs. Start read-only; remote writes need DA-114 and disposable test collections. No NotebookLM bridge or Notion setup is part of this experiment. Official NotebookLM can return to evaluation only after the revised admission gate is satisfied.

Separate document extraction loss from search misses, notebook synthesis omissions and council errors. Check Turkish text, tables, OCR and contradictory sources; measure repeat-question usage with and without cache. A cheaper result that loses critical evidence fails. See [architecture and proposed acceptance gates](../KNOWLEDGE_SOURCES.md).
