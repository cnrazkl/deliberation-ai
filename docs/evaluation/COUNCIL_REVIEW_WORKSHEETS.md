# Council review worksheets

For DA-068's external-domain suite, use [the correctness guide](COUNCIL_CORRECTNESS.md). `pnpm correctness:prepare` has already prepared separate blank worksheets in `.local/external-council-labeling`; append `--external` to the compile/adjudication commands below. The original project-only files remain separate. Both workflows still require actual independent humans and a third adjudicator.

DA-054 prepares two separate offline worksheets from the frozen [candidate intake](COUNCIL_CANDIDATE_INTAKE.json). This is preparation for human labeling, not a completed gold corpus or a model evaluation.

Run `pnpm labeling:prepare` once in the application repository. It creates:

- `.local/council-labeling/reviewer-a/worksheet.json`
- `.local/council-labeling/reviewer-b/worksheet.json`

The local files are ignored by Git and are never overwritten by the command. Give each file to a different human reviewer separately. Each contains the same frozen question and source text, but omits the development/held-out assignment, risk tags, the other reviewer's work, and model output. File separation and distinct reviewer ids do **not** prove that two people worked independently; the coordinator must verify that outside the software.

Each reviewer enters their own nonempty `reviewerId` and at least one material claim for every case. A claim uses this shape inside the case's `claims` array:

```json
{
  "statement": "A single, source-supported answer claim",
  "critical": true,
  "evidenceQuotes": ["an exact, uniquely occurring excerpt from this case's sourceText"]
}
```

Use `critical: true` only when omitting or misstating that claim would materially change the answer or safety interpretation. Multiple material claims need separate entries. Each evidence quote must occur **exactly once** in that case's frozen source text; choose a longer quote if a short phrase repeats. Reviewers need not count character positions. They should not consult council output, one another's sheet, or held-out predictions while labeling. They must not edit the frozen question, source text, digest, case id or intake digest.

After both people finish, run `pnpm labeling:compile`. It rejects missing claims, altered source/question data, stale intake, duplicate reviewer ids and absent or ambiguous quotes. It converts accepted quotes to exact UTF-16 spans and creates `.local/council-labeling/compiled/review-a.json` and `review-b.json`. It will not overwrite existing compiled files. These two review sheets are **not** gold labels: a third, distinct adjudicator still must map or explicitly reject every review claim with reasons, and the corpus assembler must pass before any model-quality measurement. This command makes no provider call and sends no data over the network.

## Third-person adjudication

After both compiled review sheets exist, run `pnpm labeling:adjudication:prepare`. It creates `.local/council-labeling/adjudicator/worksheet.json` for a **third person**. Each case shows the frozen source/question and both reviewers' claims with exact evidence spans. Split/risk tags and council/model output remain omitted. The `goldClaims` and `rejectedReviewRefs` arrays start empty; no model or script chooses a winner.

The adjudicator enters a distinct `adjudicatorId` and resolves every review claim. For each final claim, add a plain-language `statement`, `critical`, one or more exact unique `evidenceQuotes`, and `reviewRefs` identifying the contributing reviewer claim ids. If only one reviewer contributed, add a nonempty `disagreementRationale`. For a review claim excluded from all final claims, add its `reviewerId`, `claimId` and a reason in `rejectedReviewRefs`. A final claim example:

```json
{
  "statement": "The application resumes queued jobs after restart.",
  "critical": true,
  "evidenceQuotes": ["Restarting them resumes queued work from the database."],
  "reviewRefs": [
    { "reviewerId": "person-a", "claimId": "review-001" },
    { "reviewerId": "person-b", "claimId": "review-001" }
  ]
}
```

Do not force a disputed case into the corpus if the source does not resolve it. `pnpm labeling:adjudication:compile` refuses an empty final claim set, a stale or edited source/review, reused identities, ambiguous evidence, unaccounted review claims or a one-reviewer final claim without a rationale. Only after all cases pass does it write ignored local `adjudication.json`, `corpus.json` and `manifest.json` files under `.local/council-labeling/compiled/`. The manifest fingerprints the corpus and complete labeling inputs. Passing this structural gate is still not proof of reviewer identity, source authority or model accuracy.
