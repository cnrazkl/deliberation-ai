# Early-stop shadow inspection

8 October: the live diagnostic configured for three review rounds was inspected
read-only after a partial first review barrier. Incomplete history, unresolved
challenge and unassessed semantic materiality block early-stop approval. The system
continues to keep automatic stopping disabled. Independent material-change labels
and the full study remain pending. [Recorded diagnostic](../NON_HUMAN_COMPLETION.md).

DA-078 adds a read-only retrospective inspection of saved council review rounds. It does **not** stop a run, enqueue work, call a provider or claim that repeated model text is correct. Use `pnpm early-stop:inspect <run-id>` against a terminal run owned by the local installation. The command prints only the run id, round numbers, structural observation and reason codes; it does not print the question, claims, credentials or raw responses.

The inspector considers only boundaries at which another selected review round remained. One closed review round cannot establish a change trend, so it reports `insufficient_history`. After round 2 of a three-round run, it verifies complete initial member work, one review and saved prompt plan per member in each compared round, required peer targets, prompt fingerprints, and a consistent v1/v2 or v3 protocol. It then compares normalized parsed summaries, review claims, self-revision proposals and citation metadata by reviewer. A difference is `changed`; exact repetition is `exact_repeat`. Missing or altered records yield `unavailable`. High-risk cases without a completed red-team member are flagged.

Every assessment has `automaticStopAllowed=false`, `semantic_materiality_unassessed` and `accuracy_effect_unmeasured`. A repeated structured packet can omit source material, retain a wrong consensus, or hide a meaningful change in unstructured text. A stable unresolved challenge is shown as `unresolved_challenge`, never called resolved. This observer does not alter `reviewExecution.stopReason`, the claim ledger, provider receipts or the selected number of rounds. Historical reports without trustworthy prompt provenance fail closed.

Automatic information-stability stopping remains blocked until independent human labels and source-bound model runs establish material-change/contradiction coverage, false-stop rate and the effect on critical claim loss under matched budgets. The local 40-case comparison plan currently has no linked live runs. The owner-selected round ceiling and existing failure barriers remain the only automatic review-stop behaviors.
