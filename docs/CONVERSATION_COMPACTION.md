# Reviewed manual continuation compaction — DA-091

DA-093 subsequently adds [durable conversations and complete retained-run export](CONVERSATIONS.md), including private compaction archives with explicit missing-body and legacy reconstruction boundaries.

The owner can replace complete historical report/context text with an explicitly reviewed **owner-written summary** for a new question. This is manual compaction with an omission ledger and retained original, not semantic equivalence, automatic summarization or a quality improvement claim. It is a bounded extension of [DA-090 continuation](CONVERSATION_CONTINUATION.md).

## Owner workflow

Open a completed/partial report and choose **Geçmişi kısaltarak yeni soruyla devam et**. The form retains the source question, lists which full sections will be replaced, and exposes the complete original text for inspection. Write a 10–8000 character summary, considering minority views, unresolved challenges, failures and uncertainty. Check **Özeti ve atlanan bilgileri inceledim; bu kısaltmayla devam et**. Then inspect the normal member input, token and risk preview and submit the new question.

Editing the summary clears its review checkbox and blocks submission until it is reviewed again. Source changes invalidate the bound preview; reselect the report to inspect current history. There is no model call during selection, writing or preview. Fresh independent round-0 calls and selected review rounds start only through normal run submission. Scheduling remains unavailable.

The summary replaces **all full report text**, including raw outputs, claim/minority ledgers, reviews, failures and evidence labels. Earlier delivered context and any earlier original archive are also replaced. The original source question, status and prompt provenance stay explicit. The summary may reproduce parts in the owner's own words, but no omitted section is automatically considered preserved. The omission ledger identifies replaced sections and binds each original section's UTF-8 length and SHA-256. Full originals remain separately inspectable.

## Delivery and archive

`GET /api/runs/:id/continuation?mode=compaction` returns an owned `continuation-compaction-source-v1` review packet. Original source text is limited to **2 MiB UTF-8**, including earlier private archives; excess fails visibly without truncation. This can support sources above the normal 256 KiB delivery limit. It is not unbounded history storage.

Preview/create use the source id/digest plus strict `manual-continuation-compaction-v1` summary and `reviewed: true`. The server reconstructs the original and omission ledger; client archival bodies cannot replace trusted source data. Source checks, preflight fingerprints, idempotency, locked enqueue and clarification guards remain in effect.

The delivered context uses **`run-continuation-v2`**, with source question/provenance, owner summary, omission metadata and a notice that full details are absent. Instructions reject authority from historical consensus and the summary. Actual member and review inputs use this exact frozen context. Input estimates count this delivery, not private archived text; a specific shorter fixture estimates fewer tokens, but no general reduction or invoice-cost claim is made. Existing `run-continuation-v1` rendering and hashes remain compatible.

`runs.continuation_archive_ciphertext` stores a `continuation-compaction-archive-v1` packet, original text, reviewed selection and delivered digest. Its authenticated context is `run:<id>:continuation-archive`. Archive validation reconstructs source/omission fingerprints and matches the delivered compacted context before dispatch. It is excluded from worker/provider input.

Source retention does not erase the child's original archive; the copy follows the child's own retention lifetime. Selected-member reruns carry the same encrypted original/audit copy. Full-context descendants also retain it privately while passing only previously **delivered** history; they do not restore omitted raw text to provider input. A later manual compaction includes earlier archival provenance in its private original, within the same bounded limit. Archive matching walks at most 64 delivered ancestors and fails closed.

Risk evaluation scans the **original** historical text before compaction and inherits high-risk controls from the source. Neutral wording cannot remove a required red-team/review floor. The summary and evidence labels do not acquire external verification. All members receive the same untrusted context independently in round 0 and again in reviews.

Run details distinguish delivered context from the private original/omission archive. JSON export includes both, in plaintext, even after ancestor deletion. Source attachment bytes, separate memory/tool inputs, evidence records and decision assessments remain outside this continuation snapshot.

## Local acceptance and remaining work

Tests cover strict reviewed selections, original/summary/omission binding, UTF-8 bounds, oversize source compaction, original risk controls, stale source/summary rejection, idempotency, clarification, ancestor deletion, private archive inheritance, member reruns, no archived text in actual provider inputs, export and authenticated backup inventory. Browser tests use only loopback mock endpoints and prove review invalidation and actual compacted input delivery.

Local acceptance does not establish summary fidelity or model answer quality. Run branch navigation is delivered by [DA-092](RUN_BRANCHES.md). Real-provider acceptance, selective extractive compaction, a conversation aggregate and sibling-aware conversation export remain separate work. Authoritative billing/payment acceptance and hard input/tool/money limits remain open.
