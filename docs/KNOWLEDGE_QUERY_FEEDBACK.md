# Explicit knowledge queries and feedback

DA-126's literal-question diagnostic exposed 22 refusals and 18 empty packets per
40-question phase. The existing lexical AND policy expects short, owner-selected
source words. This follow-up makes that boundary visible; it does not tune retrieval,
rewrite the frozen cohort or establish semantic quality.

The search field requires explicit input. A blank field never substitutes the council
question, and preparation stays disabled until the query is valid. Its fixed example,
help, distinct-word counter and accessible invalid status explain that all search
words must occur together in one source. Up to 12 distinct normalized words,
200 characters per word and 4,000 characters total remain the existing limits.
Repeated words count once; Unicode compatibility normalization, lowercasing and
Turkish dotted-I normalization are shared between UI and backend. No query is
silently shortened or rewritten. Editing still invalidates the prepared packet and
its review.

The BFF returns public query-limit feedback as HTTP 422 / knowledge_query_invalid.
Authorized preparation without a matching excerpt returns HTTP 422 /
knowledge_evidence_not_found and asks for fewer source words. This does not mean
the source contains no answer. The query remains editable. The existing explicit
evidence-free choice, separate packet review and continue-without-packet action
remain available; no automatic dispatch or empty-packet acceptance is added.

Typed query/no-match errors inherit the existing access-error boundary, preserving
callers and diagnostic classification. Missing/foreign/revoked selection failures
keep generic access feedback; source identities, contents or existence hints are
not added to errors. The source inventory, matching/ranking policy, budgets, grants,
version/freshness checks and frozen historical packets remain unchanged.

Validation:

- Two unit cases cover distinct normalized terms, punctuation/empty input,
  exact word boundaries, oversized input and no silent token dropping.
- PostgreSQL checks distinguish query/no-match errors and preserve foreign-scope
  refusal and explicit evidence-free packet review.
- The actual browser/BFF flow covers blank/13-term disabling, accessible feedback,
  no-match messaging with query preservation, direct invalid BFF submission and
  successful source preparation/review/delivery after a corrected query.
- Full unit/integration/type/lint/build and final publication results are recorded
  in CURRENT_STATE.md.

Final local checks: 341 unit cases / 58 files, 249 isolated PostgreSQL cases / 30
files, one focused actual browser/BFF case, typecheck, zero-warning lint, separate
production build and dependency audit pass. All transport is local/offline.

No SQL migration, live provider call, source import to the owner database or
independent quality acceptance is introduced. DA-119 human labels and DA-126
empirical gates remain open.
