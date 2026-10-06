# Evidence candidate inbox — DA-123

An explicit owner action captures one candidate for one retained report claim.
The inbox extends `evidence_sources`; it does not introduce a second truth system.
Existing public research capture and its explicit excerpt transfer remain available
beside the inbox. No candidate operation fetches a URL, invokes a model/tool,
changes a claim annotation, saves to a collection or publishes externally.

## Intake and immutable provenance

- Owner: HTTP(S) URL, title, exact supplied passage (1–4,000 characters), optional
  owner-supplied publication date and support/contradiction/context relation.
  Submission is not a claim that the application retrieved or authenticated it.
- Model citation: select a stored round-0 member/citation index and a claim with
  that member's occurrence. The server copies the stored URL/title, occurrence
  passage, member identity and raw-response SHA-256. A member's citation list does
  not prove that the citation supports this particular claim. The source passage
  stays **absent**; the model passage is separately labeled and cannot be marked
  verified/current. An owner may submit a separately captured passage linked to
  the old candidate. Cross-review citation intake is outside this version.
- Local excerpt: explicitly select an excerpt from this run's frozen packet.
  The server copies its exact text, file title, source/version IDs, original/text
  hashes, extraction parser, grant revision and page/span locator after current
  grant authorization. No arbitrary caller text, new retrieval or full-file upload
  is accepted. Selected-file import remains the library's DA-121/122 workflow.

Claim statement, relation, title, URL, source passage, provenance, original capture
time and supplied publication date remain frozen. An optional previous-source link
must refer to an owned record for the same claim. This is an additive link, not a
replacement: contradictory and older passages remain inspectable side by side.
Changed remote content must be a new submitted candidate; no background refetch
or overwritten original is claimed. Publication dates remain unknown when absent.

## Human review and freshness

Content: unreviewed / human reviewed (`verified`, existing storage terminology) /
rejected. Human review is not proof of truth. Freshness is a separate owner decision:
unreviewed / current / needs-review / stale / changed / inaccessible. Updating one
does not approve the other. The existing latest-decision storage is reused; this
increment does not add an append-only history of every review correction.

Local availability is independently observed at list/export time: same version,
changed version or inaccessible grant/source. It never silently rewrites human
decisions or approves remote sources. Original run-derived copies remain inspectable
after revocation, as historical owner records; fresh candidate intake, current
assessment and new source-dependent evidence annotation fail closed. Revocation
does not recall an already submitted call or erase historical copies.

Inserting/reviewing a candidate does not change the report's evidence state. A separate
explicit existing claim annotation requires a human-reviewed/current qualifying
source; changed/revoked local candidates do not qualify. Candidate records are not
eligible for TypeSafe transmission in this version. DA-124 adds separately reviewed [reusable saving/manual handoff](EVIDENCE_PUBLICATION.md); external publication still requires an admitted adapter. Independent DA-119 labels and DA-126
quality/entailment acceptance remain open.

## Storage, recovery and limits

Migration 0053 adds nullable `evidence_sources.candidate_provenance_ciphertext`,
AES-GCM AAD `evidence-source:<id>:candidate-provenance`, and the two freshness states.
The existing immutable snapshot trigger also protects candidate metadata and
identity/title/URL/note/relation. Only existing review fields can change.

Creation UUID equals the candidate ID and binds a canonical parsed-request hash.
Identical acknowledgement replay returns the retained record, even after revocation;
changed/foreign identities fail. Owner serialization and the claim row protect
concurrent creation, grants, reviewed deletion and the shared ten-sources-per-claim
quota. The BFF streams at most 32 KiB, uses strict whitelisted requests, no-store
responses and local-origin mutation protection. Source text is encrypted, not logged.

Rejecting preserves originals; individual candidate removal is refused to preserve
links and retry identities. Existing reviewed run-body deletion includes and removes
the associated candidate rows, and changes in review/ciphertext invalidate its
preview fingerprint. Ordinary run/conversation JSON/Markdown exports retain their
existing scope and do not silently include separate evidence records. **Adayları
indir (JSON)** explicitly exports all this run's candidates, exact provenance,
both decisions and current local availability with an export timestamp. This is a
plaintext sensitive artifact, not a collection permission or publication receipt.

The exhaustive backup inventory validates the new ciphertext, same owner/run/claim
relationships, additive links and exact local immutable extraction/quote round-trip.
Historical pre-0053 archives remain supported when the entire optional column is
absent. Populated disposable dump/restore verifies original passages and separate
decisions after revocation. No owner database migration is implied by source delivery.

[Verification](DA123_ACCEPTANCE.md), [source architecture](KNOWLEDGE_SOURCES.md),
[ADR](adr/0038-evidence-candidate-inbox.md).
