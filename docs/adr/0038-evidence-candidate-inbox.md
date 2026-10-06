# ADR-0038 — Extend evidence sources for the human candidate inbox

Status: accepted implementation, 6 October 2026.

Existing evidence sources already retain immutable source passages and independent
human content/freshness decisions. Reuse these records with nullable encrypted,
immutable candidate provenance instead of building a parallel truth store. Retain
the existing claim/source limits, owner boundary, export scope and reviewed deletion.

Owner submissions, stored round-0 model citations and frozen local packet excerpts
are distinct origins. A model occurrence is not the cited document; its passage
stays separate, and missing original content cannot be verified/current. Changed
sources are new linked candidates. Live local grant/version observations are separate
from saved human judgments, and block new source-dependent authorization.

Candidate intake/review cannot automatically annotate claims or transmit data.
Reusable saving and admitted publication are DA-124; TypeSafe candidate transmission
is not admitted here. Rejecting retains originals; reviewed run deletion removes
them. Optional ciphertext preserves old backups, while new archives validate exact
local provenance and owned candidate links.

[Contract](../EVIDENCE_CANDIDATES.md).
