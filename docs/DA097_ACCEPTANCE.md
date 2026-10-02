# DA-097 local acceptance — reviewed private delivery

Accepted: 2 October 2026, primary local repository. Supported scope is OpenAI-compatible
source members with default reasoning/web search off and standard-risk actual input.
This is not acceptance of every provider, model quality, real billing or private erasure.

## Change

Completed the existing partial backend with owned GET/POST/PATCH delivery routes,
explicit exact-input review, idle draft preservation, observed reply/usage display,
pending polling, queued cancellation, recovery checks and acknowledged unknown-result
closure. Connection locks protect claim-time revision checks. Lost-response retry
deduplicates one intent; reply-aware fork review binds the delivery version. Failed-output
usage is encrypted separately from the optional successful result. No migration is added.

## Evidence

- 255 offline unit tests across 41 files passed, including new plain-text adapter tests.
- 152 isolated PostgreSQL tests across 19 files passed. Eight new cases cover concurrent
  intent/replay, ownership/risk/settings boundaries, connection drift with zero dispatch,
  interrupted submission, overlapping workers, permanent capacity, forks/source retention
  and actual populated archive restore.
- Full 21-flow browser suite passed. The new private flow uses an actual local HTTP
  fixture and real pg-boss/worker, loses a committed enqueue response, retries to exactly
  one provider request, reads usage/reply and forks the transcript with unsaved text intact.
- Package/web/worker/root type checks, zero-warning lint and separate-output production
  build passed. The development server remains separate from build verification output.

The initial unit check exposed the historical queue test's missing private-queue
expectation; it now verifies all recovered queues. An initial integration assertion used
the wrong audit field name; corrected without changing the audit. The first focused
browser attempt had no worker because stopping the parallel web process had also closed
its sibling worker. After separately restoring the worker, the focused repeat and full
suite passed. No product retry/timeout rule was weakened to obtain success.

The restore case requires a generated `da_it_*` database, dumps it, restores into a new
random temporary database, authenticates/decrypts private receipts and compares the
stored envelope. Both restore database and archive are removed; the integration runner
drops its generated database. Browser fixtures remove only their generated identities.
No paid/cloud model request, JEV call, owner-history pruning or application migration ran.

## Limits

Each origin branch has eight nonrefundable admitted requests, one 1,024-output-token
cap per request and bounded input/result/body storage. Usage is observed, nullable and
separate from council billing totals. Unknown outcomes never authorize blind resubmission;
only queued work can be cancelled. Other providers/settings, in-flight cancellation,
private-body/copy erasure, input/tool/money enforcement and live-provider accuracy remain
open. The next bounded work is broader private-provider support or an explicitly reviewed
private-content deletion policy, after selecting which product boundary to advance.

The requested `.next` cleanup was attempted but shell policy blocked recursive removal.
No cache or owner data was deleted. The web/worker were restarted independently for
verification; old cache retention is still unresolved, not a claimed completed cleanup.
