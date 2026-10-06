# Reviewed reusable evidence — DA-124

An approved candidate can be saved only by a separate owner action. Human content
review (`verified`) and freshness (`current`) must both be present, with an exact
original passage. Model citations with no source passage, changed local versions
and revoked source grants are refused. Saving never changes claim evidence state.

## Exact review and local storage

The owner selects an explicitly granted local collection, previews the complete
passage, original title/URL, claim/relation, destination identity and sharing effect,
then checks consent and confirms. The digest binds the entire candidate snapshot,
review timestamps, destination name, account, collection and grant revision. Edits
invalidate the browser review; the server repeats eligibility/ownership checks under
the same owner serialization used by grants and review. No ambient active notebook
or caller-supplied replacement passage is accepted.

The save creates an immutable encrypted publication receipt and an ordinary local
TXT source/version in one PostgreSQL transaction. The TXT contains the exact source
passage only, without a model summary or normalization. The receipt retains title,
URL, publication/capture/review dates, original model/file provenance, claim, relation
and previous-candidate link. These are reviewed copies, not independently confirmed
sources. The deterministic lexical reader can use the new version after an explicit
conversation selection; saving does not select it or submit a council run.

The committed source is read back before success. `lexical_at_save` means it was
available to local lexical search when saved, not a background index or perpetual
permission/readiness promise. Current grant/version controls still govern reuse.
The destination's version is never silently overwritten. Receipt downloads include
all frozen metadata so the passage's original provenance stays inspectable.

## Recovery and deduplication

The UUID request slot binds the exact confirmed request. An identical retry returns
the historical receipt after a lost response, even after later revocation; it makes
no new access or write. Changed/foreign reuse conflicts. Source intake and saves
share a bounded lock; repeated/concurrent saves of the same candidate original to
the same collection reuse one source/version. Different candidates/versions,
contradictions and destinations remain distinct. A failed receipt insert rolls back
both source and receipt. There is no local uncertain upload state because commit is
atomic; acknowledgement recovery queries the durable receipt rather than recreating
the source. Five hundred owner receipts and existing 120-version/128-MiB storage
ceilings bound the operation. No provider, retrieval, indexing service or tool is called.

## Manual handoff and optional adapters

No external adapter is admitted. The generic manual mode binds a declared target
name, account and HTTPS link, displays the exact sensitive payload and freezes an
`awaiting_manual_addition` receipt. The JSON packet is downloaded only by the owner;
the app neither visits the link nor uploads/shares/deletes anything. Preparing or
downloading does not mean the target received it. A separate **Adlandırılan hedefe
elle ekledim** action records `manual_acknowledged`; it remains an owner declaration
with remote read-back `not_performed` and indexing `unknown`, never verified delivery.
Repeated acknowledgements preserve the first timestamp. There is no remote retry.

Adapter admission, durable remote submitted/unknown reconciliation and remote
read-back/indexing tests remain conditional on a later separately accepted adapter.
Manual packets do not bypass that gate. Local acceptance has no remote dependency.

## Copies, encryption and deployment

Migration 0054 adds `evidence_publications` with immutable snapshot protection and
only the pending-to-owner-acknowledged transition. AES-GCM AAD is
`evidence-publication:<id>:body`. Candidate, run and destination identifiers are
metadata; all source content and sensitive destination details are encrypted.
No cascading run FK is used: reusable sources/receipts are independent copies.
Reviewed run deletion blocks with `copied_content` when a publication exists, so
retention cannot pretend it erased a reusable or external copy. Dedicated copy-aware
publication/source erasure remains open; this feature adds no automatic erasure.
Exports/backups and owner-created remote copies remain separate sensitive artifacts.

The exhaustive archive audit validates payload/hash/owner identities and exact local
source read-back. Pre-0054 archives are supported when the whole optional table is
absent. Generated dump/restore includes a local save and manual acknowledgement,
then verifies them after candidate rejection and grant revocation. Independent human
quality and DA-126 empirical acceptance remain open. [Verification](DA124_ACCEPTANCE.md).
