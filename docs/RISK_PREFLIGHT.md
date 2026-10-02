# Local risk preflight — DA-069

DA-091 scans original historical text before manual compaction and carries its effective control floor into delivered history. A neutral owner summary cannot lower the source/history requirement for red-team and reviews. This does not certify the summary or make the lexical rules semantic. [Compaction policy](CONVERSATION_COMPACTION.md).

DA-090 adds complete frozen historical text under the `conversation` signal source. The same conservative rules scan it, and a high-risk source retains the high control floor even when its prior attachments are absent. Preview, normal enqueue, clarification and member reruns apply this floor. [Continuation boundaries](CONVERSATION_CONTINUATION.md).

This is the first delivered part of broad group 2. It adds a conservative control floor, not a measured semantic risk classifier. No hosted model is called during preflight and no question is rewritten.

## Owner workflow

The profile selector defaults to **Otomatik (en az standart)**. The owner may explicitly select high risk. Once valid members are configured, the token preview also shows the effective profile, detected categories and whether they came from the question, a PDF, selected memory or tool context. Uninspected images receive the high control floor.

When required controls are missing, **Gerekli risk kontrollerini ekle** enables cross-review and adds red-team using the last member's connection. At six members it changes the last member's role instead. The UI explains this before the click; the owner can edit the connection/model before sending. Automatic assessment itself never adds members or submits a run. Clearing a risk term recomputes the draft assessment but does not remove owner-selected controls.

## Policy and limitations

- `risk-rules-v1` scans Turkish/English lexical patterns for health, law, finance, physical safety and irreversible actions. Unicode normalization covers Turkish accents, casing and format characters; it is not an adversarial-language defense.
- It scans the original question and frozen memory/tool text. PDF text and images participate only when at least one member receives attachments. The server verifies PDF extraction before applying the policy at enqueue.
- Quoted, negated and educational mentions can raise the floor. An instruction inside a source to classify it as safe cannot lower it. False positives are an intentional tradeoff of this narrow rule set.
- Images are not semantically inspected here. Any delivered image raises the floor rather than acquiring an unsupported safety label. Image-only PDFs still require the separately deferred OCR work.
- Unmatched language, indirect phrasing and omitted context can escape these rules. No-match means **no configured signal found**, not low-risk certification. Sensitivity/specificity and multilingual coverage have not been measured. The owner can always raise the profile.
- High risk requires a configured red-team member and at least one cross-review before enqueue. Existing post-run completion controls still require successful participation, complete peer coverage and intact claim transfer. They do not establish factual correctness.

## Boundaries and persistence

`assessRequestRisk` and `assertRiskConfiguration` are pure domain functions. Application `buildRiskPreflight` binds the assessment, current round-0 prompt fingerprint and review-round choice in a SHA-256 digest. The local preview returns it; the browser submits `expectedRiskFingerprint`. A mismatch returns 409. Omitting the digest never waives the server's risk floor or required controls.

Every new durable run stores the effective `risk_profile` and context-bound encrypted `risk_assessment_ciphertext`: policy version, requested/effective profiles and bounded category/source-kind reasons, with no copied source text. Migration `0026_polite_blizzard.sql` leaves historic rows null. The run view and JSON export expose the assessment; bounded history does not decrypt it. Existing request hashes remain unchanged when the new optional fingerprint is absent. Idempotent replay returns the original run without changing its frozen policy decision.

The worker checks the saved assessment/profile and mandatory controls before provider dispatch, alongside the existing prompt check. Mismatches produce `risk_snapshot_mismatch` failures without calling a model. Legacy rows without this assessment retain their historical path; they are labeled as lacking an automatic assessment rather than retroactively certified.

Schedule creation and activation check the question against the same floor. Dispatch checks it again through normal enqueue. A legacy active schedule that no longer meets the required controls is paused without dispatch or advancing its occurrence; activation returns an actionable error. Schedules do not inherit draft attachments/memory/tool context.

Backup verification includes the new ciphertext family. Older-schema archives require their matching verifier/migration procedure; the current exhaustive verifier rejects an inventory mismatch rather than skipping unknown or missing fields.

## Acceptance and remaining work

Offline fixtures cover Turkish/English signals, negation/Unicode, explicit escalation, all text source kinds, unknown images, attachment consent, frozen preview changes, encrypted persistence, idempotency, worker drift, direct API rejection and legacy scheduling. Browser coverage checks the explanation, blocked submission and explicit addition of controls while preserving the question. These are implementation checks, not empirical classification-quality evidence.

DA-070 subsequently added the separate [critical missing-context workflow](MISSING_CONTEXT_PREFLIGHT.md). Broad group 2 is still open: original/optimized prompt revision and material differences, independent transformation checks where required, and later-round prompt inspection remain. Broad group 1's independent human review and actual model study remain pending under the owner's instruction; DA-069/070 do not fill in their labels or results.
