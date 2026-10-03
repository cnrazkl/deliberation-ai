# Saved council-template lifecycle — DA-108 preparation

Verified 3 October 2026. DA-108 remains open.

## Delivered save boundaries

A create request without an id uses the owner's exact template name. If that name
already exists with the same description and ordered member configuration, the saved
template is returned without rewriting encrypted content or timestamps. A different
description or member configuration returns HTTP 409 and leaves the saved row intact.
The UI retains its name/member draft on failure and explains the conflict.

An explicit id is an update of that owned row only. Missing, foreign or deleted ids
are refused; they never fall back to creating a new template with a new identity.
Owned explicit updates still work. A stale create payload cannot undo changed content.

Save and delete share an owner-scoped transaction advisory lock with bounded lock and
statement timeouts. Overlapping identical creations return one identity; conflicting
creations preserve one draft. An explicit update racing deletion cannot resurrect a
removed row. The database owner/name unique index remains the final uniqueness guard.
These locks coordinate application writes, not arbitrary external SQL administration.

## Still required for DA-108

The existing delete endpoint still physically removes the template immediately.
It has no read-only deletion preview, state fingerprint, acknowledgement or retained
deletion receipt. Creation without an id has no durable request identity: after physical
deletion, replaying the old id-less create request can create another row. Name reuse
and later explicit edits also prevent name/content matching from being a durable intent
record. This increment does not claim complete creation replay or deletion protection.

The next increment must define reviewed deletion, content-free creation/deletion receipts,
exact-state confirmation, name reuse, lost-response recovery and stale request refusal.
Register any encrypted schema additions in the exhaustive backup inventory and verify a
populated disposable restore. Independently frozen run/schedule configurations and
external backup/export copies need explicit preserved-copy explanations.

## Verification

- 274 offline unit tests pass.
- 193 isolated PostgreSQL cases pass, including eight new template regressions:
  unchanged retry ciphertext/timestamps, conflicting content, missing/deleted update ids,
  owned updates, foreign ownership, identical/conflicting concurrent creates and
  overlapping update/deletion.
- One focused browser case passes against real local routes: lost create response,
  unchanged retry, HTTP 409 conflict, deleted-id refusal, preserved question and zero
  generation submissions. The full browser suite was not rerun for this bounded change.
- Workspace type checks, zero-warning lint, separate-output production build and full
  dependency audit pass. A fresh checkout initially lacked Next-generated LayoutProps;
  build/dev generated them before the successful type-check repeat.

Integration migrations apply only to the automatically removed disposable database.
No application schema change, primary database migration, real owner deletion or paid
provider call occurred. Browser cleanup removes only its uniquely named generated fixture.
