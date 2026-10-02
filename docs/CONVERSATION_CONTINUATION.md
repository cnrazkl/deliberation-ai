# Explicit report continuation — DA-090

DA-093 subsequently adds [durable conversations and complete retained-run export](CONVERSATIONS.md). Continuing a new question now also inherits its immediate source's conversation identity without changing the frozen-input contract below.

DA-091 now adds [reviewed manual compaction](CONVERSATION_COMPACTION.md), including separate private original archives. Full-context descendants receive only earlier delivered history and carry originals privately; those archives are never silently inserted into provider input. The details below describe the original full-context path.

This first conversation increment lets an owned completed/partial report supply reviewed historical context for a **new question and new council run**. It does not complete the broader conversation gate or measure answer quality.

## Owner workflow

Open a saved report and choose **Bu rapordan yeni soruyla devam et**. The form clears the question and displays the full selected text. Review it, check **Geçmiş bağlamı inceledim; yeni soruma dahil et**, enter a new question and inspect the normal member prompt/token/risk preview. The current form's member settings, optional execution limits and selected inputs apply. Selection and preview make no provider call; the normal submit action starts the new run.

Context contains the source question, complete hydrated report (raw outputs, minority claims, reviews, failures and report annotations), source prompt provenance and any earlier frozen continuation. It does **not** separately replay prior attachment bytes/PDF text, memory/tool inputs, external evidence records or decision assessments. Historical evidence labels and consensus are not newly verified evidence. Current form inputs can still be explicitly selected through existing controls.

Every member receives the same history independently in round 0 and again in later reviews. No source member output or receipt is reused. First-round token estimates include the entire rendered historical text for each member; later rounds and provider framing remain outside the estimate. Execution reservations are fresh and do not imply a monetary cap or exact price.

## Frozen contract and retention

- `GET /api/runs/:id/continuation` resolves an owned completed/partial report with at least one successful member. Missing, foreign, unfinished and unsupported sources are unavailable.
- Preview/create accept `continuationSource: { runId, expectedSha256 }`. The server loads the report; a client cannot supply the historical body as trusted input.
- `run-continuation-v1` binds source id, risk profile and full content with SHA-256. The content is limited to **256 KiB UTF-8**, including earlier history. Oversize is refused visibly; no silent truncation or summarization occurs.
- The existing `council-v1` fingerprint includes rendered history. Requests without continuation retain their prior rendering and request hashes.
- Enqueue rechecks the source digest under the row lock shared by report editing and retention, then stores authenticated encrypted `runs.continuation_context_ciphertext` with context `run:<id>:continuation-context`.
- Source changes invalidate pending previews. Re-select to review the changed report. Clarification drafts retain the original pointer/digest; drift/deletion blocks resumption instead of substituting context.
- Worker dispatch reads only the child's copy; prompt integrity checks prevent calls after snapshot changes. Execution never reloads ancestors.
- Source pruning does not erase copies frozen in descendants. Each child has its own retention lifetime. Details and plaintext JSON export expose the exact copied text and provenance.

Risk preflight scans historical text with the `conversation` source label and inherits a high-risk source's floor, even when its original attachments are not replayed. Red-team and a review remain mandatory at high risk. Historical text is labeled untrusted in provider input.

Selected-member reruns preserve a continuation's frozen history and their established reuse semantics. Continuing with another new question starts all members anew. Scheduling a draft with history is explicitly unavailable; UI and schedule API do not silently discard its pointer.

## Verification and open scope

Unit/PostgreSQL checks cover source/digest/risk binding, UTF-8 limits, identical preview/actual input, review delivery, token counting, source drift and ownership, idempotency, ancestor retention, nested context, clarification/resumption, dispatch integrity, member-rerun inheritance and export. Browser acceptance uses a loopback mock and checks minority/raw context, explicit review, fresh independent calls and preservation of the source. Backup checks audit the populated new ciphertext and reject an incorrect authentication context.

Reviewed manual compaction is delivered by DA-091 and run branch navigation by [DA-092](RUN_BRANCHES.md). A durable conversation aggregate, sibling-aware conversation export and real-provider acceptance remain open. Authoritative invoice/payment acceptance and hard input/tool/money limits are separate open gates. No paid or live-provider call is needed for this local increment.
