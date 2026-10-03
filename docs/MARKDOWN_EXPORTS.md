# Markdown history and synthesis — DA-109

Owner-requested insertion before remaining DA-108 work, verified 3 October 2026.

## Workflow and scope

**Konuşmayı indir (MD)** appears beside conversation JSON download. It exports the
same owned repeatable-read snapshot: run questions, frozen history/original archives,
independent raw/structured replies, cross-reviews, failed outputs and saved review inputs.
Missing bodies/source links remain explicit; running work keeps its instantaneous status
without inventing a report. Private branches retain seed replies, saved owner drafts,
delivery replies/receipts and fork/copy provenance. Content-free deletion audits remain
separate. Structured details are inspectable in JSON blocks inside the Markdown.

**Sentezi indir (MD)** appears in synthesis coverage. It exports the selected terminal
report's question and all included/unresolved/omitted shared, distinct and red-team claims,
with source occurrences/quotes, evidence states, scope notes, relations, mechanical quality
and prompt/risk provenance. It creates no new model synthesis or truth judgment.

Both downloads preserve the draft and start no generation or database mutation. Existing
JSON downloads remain available. Downloads are plaintext independent copies containing
sensitive saved text. Credentials and internal run intent/request/snapshot keys remain
excluded. Separate attachment bytes, memory/tool/evidence records and decision assessments
remain outside the existing conversation export boundary.

## Route and formatter boundary

`POST /api/conversations/:id/export?format=md` returns history Markdown;
`POST /api/runs/:id/export?format=md` returns synthesis Markdown. Default/`json` keeps
JSON; unsupported formats return 400. Owner/UUID lookup and same-origin checks retain
404/403 behavior. Run export requires a terminal status plus report. Attachments use
UTF-8 `text/markdown`, `.md` filenames, `no-store` and `nosniff`.

Pure web formatters consume the existing safe DTOs without database/provider access.
Saved text is literal in input-sized code fences; heading metadata escapes Markdown/HTML.
Embedded fences cannot break out into active HTML or remote media. Output over 32 MiB
returns 413 instead of truncating; snapshot count/integrity/size checks remain in force.
No schema or encryption inventory change.

## Acceptance

279 offline unit tests pass, including coverage/provenance preservation, missing/running
history, private drafts, fence/HTML literal handling and oversize refusal. Two focused
real-worker loopback continuation browser cases pass. The extended case downloads JSON,
history MD and synthesis MD, verifies headers/filenames, frozen minority/history text and
coverage headings, rejects foreign-origin/unknown-id/unsupported-format requests, preserves
the draft and makes no extra provider calls. Type checks, zero-warning lint and separate
production build pass. Full browser/integration suites were not rerun for this read-only
presentation change. No primary migration, real owner deletion or paid/cloud call occurred.
