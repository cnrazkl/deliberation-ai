# ADR-0029: reviewed run-body deletion with retained usage and replay evidence

Status: locally implemented and functionally verified, 3 October 2026.
Repository dependency security acceptance remains open.

Age-based pruning removes run-owned content/receipts by declared cascades. An owner-requested
early removal needs review of exact scope, unresolved calls, copied history and accounting
consequences, and must not allow an old creation request to restore deleted content.

Remove one owned terminal leaf body only after a read-only preview and strict explicit
content/retained-record confirmation. Reuse owner serialization and the council worker
fence, with a nonwaiting lease acquisition before table locks. Register the known cascade
closure, verify catalog/triggers/ownership, authenticate bounded copied provenance and
fingerprint all affected content. Atomically retain encrypted content-free provider usage
and hashed intent evidence before removing the recorded job and one body.

Keep conversation membership, independent billing and preflight/schedule inputs. Set only
the existing preflight/schedule run pointers to null. Retained audit has no FKs, enters
conversation export/backup validation and survives eligible metadata deletion. Exact manual
delete replay returns the same audit; creation/rerun intent replay is blocked. Copies need
separate leaf review; no all-copy wipe or monetary refund is implied.

All decision aggregates remain ineligible because their execution path lacks an equivalent
session fence. JEV remains excluded. Age-based pruning is unchanged and has no audit-unification
claim. Unknown schema/trigger/graph, unreadable content or inspection overflow preserves
the target. Repository security checks remain failing on an unpatched dev-tool dependency;
no exception or disabled audit is introduced.

[Contract](../RUN_DELETION.md), [verification](../DA102_ACCEPTANCE.md),
[dependency finding](../DEPENDENCY_SECURITY_2026_10_03.md).
