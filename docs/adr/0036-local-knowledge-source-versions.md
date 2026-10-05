# ADR-0036: immutable local knowledge source versions

Accepted for the owner-authorized DA-121 backend increment, 5 October 2026.

Store selected originals and page-linked extraction as separate version-bound
ciphertexts. Preserve old source versions and exact quote locators when a source
changes. Use bounded transient lexical scans instead of a persistent plaintext or
embedding index. Current grant/selection authorization remains mandatory around
reads and before publishing an intake batch.

Parse PDFs in a disposable bounded process; preserve failed/unverified originals
without promoting their text. Explicit transient-failure retries create immutable
attempts and reuse their identity after a lost response. Never mutate parser history,
silently truncate usable evidence or infer human validation from extraction success.

This local increment needs no optional service admission. Open Notebook/RAGFlow
remain unevaluated candidates; no remote product is a dependency. DA-122 owns frozen
packet budgets/preview/routing, and DA-119/126 retain independent quality gates.
[Contract](../LOCAL_KNOWLEDGE_SOURCES.md), [verification](../DA121_ACCEPTANCE.md).
