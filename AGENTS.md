# DeliberationAI contributor instructions

Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/CURRENT_STATE.md`, and `docs/TASKS.md` before changing behavior.

Preserve these invariants:

- The council has no authoritative model or chair.
- Round 0 responses are independent and share only the frozen input snapshot.
- Minority claims, contradictions, raw outputs, and provenance remain inspectable.
- Provider SDK values stop at adapter boundaries.
- Never log credentials, prompts, raw responses, or sensitive claim content.
- A feature is complete only when the relevant checks pass and `CURRENT_STATE.md` is accurate.

Keep documentation synchronized with behavior:

- Product behavior: `docs/PRODUCT.md`
- Component boundaries: `docs/ARCHITECTURE.md`
- Schema changes: `docs/DATA_MODEL.md`
- Orchestration changes: `docs/ORCHESTRATION.md`
- Provider changes: `docs/PROVIDERS.md`
- Prompt contracts: `docs/PROMPTS.md`
- Security changes: `docs/SECURITY.md`
- Major decisions: `docs/DECISIONS.md` or a dedicated ADR
- Completed work: `docs/TASKS.md` and `docs/CURRENT_STATE.md`

Use strict TypeScript. Keep domain code independent from Next.js, databases, and provider SDKs. Network model tests are opt-in and must never run in normal CI.

## Git publication

Follow docs/GIT_WORKFLOW.md. The owner requests committing and pushing completed reviewed increments. Keep secrets and local data excluded; preserve unrelated changes, verify remote divergence, and never force push or fabricate historical contribution dates.
