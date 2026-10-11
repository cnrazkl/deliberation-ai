# Saved council pool — 11 October 2026

## Delivered behavior

The chat composer exposes owned named councils through **Konsey Havuzu**. Saving
captures ordered members (connections, models, roles, reasoning, web and attachment
choices), review-round count and self-revision. Selection applies them to the existing
draft; **Konseyi Çalıştır** retains normal preflight, risk and frozen-input dispatch.
Questions, sources, contexts and execution quotas are task state. Selecting, saving,
loading and deleting a reusable configuration generate nothing. Enter in the name
field saves the council and cannot implicitly submit the enclosing question form.

Modified drafts are identified; fresh names avoid silent replacement. Success/errors
remain beside the pool. Existing durable creation retry, conflict, owner and reviewed
deletion contracts remain. Old member-only templates default to one review/false;
complete v2 content is authenticated in the existing ciphertext, with settings included
in creation hashes. Tombstones clear all content. No schema migration was required.
Old application readers cannot load active v2 envelopes.

## Verification

- 494 offline unit and 280 isolated PostgreSQL cases pass, including v2 settings,
  unchanged retries, conflicting settings, legacy identities and full deletion.
- Generated-only custom PostgreSQL dump/restore verifies an active v2 council and a
  deleted v2 council with identical ciphertext/receipt, hidden tombstone and blocked
  replay. Temporary databases/archive were removed.
- The 118-case broad browser run passes 117 cases. The remaining legacy council
  test first referred to the replaced save-button label, then an unscoped member
  label also present in the pool. Both selectors now target the intended controls.
  All 16 final council/pool/retry/deletion/help browser cases pass. These runs disable
  native randomUUID to cover the LAN fallback. Enter-save dispatch fencing is included.
- Workspace types, zero-warning web lint and Linux persistence/worker/web checks
  and production builds pass. Full history and staged Gitleaks scans find no secrets.
- Actual LAN HTTP verifies selection, model/round restore, self-revision after reload,
  unchanged question, Enter-save without generation and light/dark layout at 320/1110px.
  Native randomUUID is absent; no page exception occurs. Production screenshots were
  inspected. The generated account/connection/councils were erased through reviewed
  fingerprint-bound account deletion; the owner's active browser was untouched.

## Authorized inexpensive real OpenRouter checks

Only the owner's existing OpenRouter connection and generic test input were used.
The two new model preferences were added without removing previous choices or
changing credentials/transport/revision. Public catalog prices were checked before
dispatch: Mistral Small 24B (`mistralai/mistral-small-24b-instruct-2501`) reports
USD 0.05/0.08 per million input/output tokens; Ministral 3B
(`mistralai/ministral-3b-2512`) reports USD 0.10/0.10. These are catalog observations,
not invoice costs or a guaranteed spend cap. Expensive model families were not used.

| Check | Actual provider calls | Observed result |
| --- | ---: | --- |
| Short plain chat, one per model | 2 | Both succeed; returned model matches selected slug |
| Saved **Hızlı Ekonomik Konsey**, two models, zero reviews | 2 | Completed, two member replies |
| Initial two-model council, one review round | 4 | Partial: three calls succeed; Ministral review fails `provider_response_invalid` |
| Revised **Ekonomik Konsey**, two independent Small 24B perspectives, one review round | 4 | Completed, two member replies and two reviews |

Twelve explicit calls were made in total. Chat requests ask for at most 512 output
tokens; council checks use per-call 2048 output tokens and exact 2/4-call reservations.
The failed review is retained and was not retried; the revised council is a separate
new run. All new intents have terminal receipts and no unknown outcome. Both named
councils remain in the owner's pool. Earlier unknown operations remain untouched.
This verifies delivery, parsing, persistence and review mechanics, not answer quality
or universal model capability. Missing billing authority remains unknown.

## Deployment

Owned LAN address remains `192.168.1.112:33184`. Web/worker/observer use
`deliberationai-rehearsal:60374dd507ec-council-pool-ui3`, manifest
`sha256:9924e2ce68b27223b8dec25c92d8488cff603c32c523aa01d30984261f97cca6`.
Exported tree `fdc29425b41511fca0e5fd26a8e0242c57c814a2` preceded the final
test-selector/documentation verification updates; executable app/packages match
source commit `1672a00`. Deployment completed at 2026-10-11T13:17:36Z after confirming
no active owned work. A private pre-deployment dump and archive inventory are retained;
its encryption key remains separate. No migration/restore or foreign lifecycle change
occurred. Owned database lifecycle matches; recreated worker catalog GET returns 200.
Completed CLI producers were stopped; owned services continue with zero restarts.
Native PostgreSQL was stopped after local checks, restoring its initial state.

Source-bound observation `month-council-pool-20261011` starts
2026-10-11T13:17:49.874Z and is due 2026-11-10T13:17:49.874Z; first sample is healthy.
Earlier windows remain retained; monthly operating and independent human quality gates
remain open.
