# DeliberationAI

DeliberationAI is a provider-independent multi-model council that preserves disagreements and provenance instead of treating agreement as truth.

DA-102 adds functionally verified reviewed terminal run-body deletion with copy/pending/fence guards, retained usage/intent audit and preserved conversation membership. Decision aggregates, independent inputs and external copies remain outside scope. Full dependency security acceptance is open on an unpatched lint-tool advisory; production dependency audit passes. [Workflow](docs/RUN_DELETION.md), [verification](docs/DA102_ACCEPTANCE.md), [security finding](docs/DEPENDENCY_SECURITY_2026_10_03.md).

DA-101 adds reviewed deletion of one private branch's stored content. Surviving copies and pending/unknown deliveries block removal; encrypted content-free usage/provenance and replay records remain. Source reports, backups and downloaded exports keep their own copies. [Workflow](docs/PRIVATE_BRANCH_DELETION.md), [acceptance](docs/DA101_ACCEPTANCE.md). Earlier erasure/deletion-absence statements describe historical scope.

DA-100 adds reviewed native Gemini `generateContent` private replies alongside OpenAI Responses, Claude/Anthropic and compatible endpoints. Exact text history, bounded text-only output, separate candidate/thought counters and durable unknown outcomes share the existing private boundary. Default reasoning/search off only; richer settings, private erasure/accounting and live/model-quality acceptance remain open. [Workflow](docs/PRIVATE_BRANCHES.md#da-100-native-gemini-generatecontent), [acceptance](docs/DA100_ACCEPTANCE.md). Earlier increment notes below describe their historical scope; provider-absence statements are superseded by DA-100.

DA-099 adds reviewed native OpenAI Responses private replies, alongside Claude/Anthropic and compatible endpoints. Stateless text, bounded output/status validation, inclusive usage and unknown-outcome controls are verified locally. Gemini, broader settings and live/model-quality acceptance remain open. No migration or paid call is added. [Workflow](docs/PRIVATE_BRANCHES.md), [acceptance](docs/DA099_ACCEPTANCE.md).

DA-098 extends reviewed private delivery to native Claude/Anthropic source members, preserving exact input review, durable intent/unknown handling and bounded output. Native uncached-input/cache counters and truncated replies are visible. No migration or paid-provider call is needed for local acceptance. Native OpenAI/Gemini, broader settings and private erasure remain open. [Workflow](docs/PRIVATE_BRANCHES.md), [acceptance](docs/DA098_ACCEPTANCE.md).

DA-097 adds reviewed private delivery to an OpenAI-compatible source model, with exact input preview, permanent bounded request slots, durable unknown-outcome handling and observed usage. Saved drafts stay idle until explicit reviewed send. Other providers/settings, private-content deletion and council billing integration remain open. DA-096 supplies encrypted branches through migration `0044`; DA-097 adds no migration. [Workflow](docs/PRIVATE_BRANCHES.md), [acceptance](docs/DA097_ACCEPTANCE.md).

DA-095 adds reviewed deletion of empty conversation metadata through the saved-conversation library. Preview/cancel writes nothing; confirmed deletion removes only one owned identity and its retained memberships after body/reference/schema checks. Backups and exports remain separate copies. [Policy and checks](docs/CONVERSATION_DELETION.md).

DA-094 is verified in the primary local application: a standalone saved-conversation list, exact timestamp paging in saved runs/branches and protection against stale history responses after refresh. See [the 2 October review](docs/REPO_AUDIT_2026_10_02.md) for checks and remaining gates. No migration or new package is required.

For local owner-reviewed billing totals and shared-charge inspection, see [the statement workflow](docs/BILLING_STATEMENTS.md). `pnpm billing:statement:inspect <absolute-json-path> <absolute-evidence-path>` is read-only and does not verify provider payment.

Use [durable statement history](docs/BILLING_STATEMENT_HISTORY.md) to preserve reviewed packets, corrections and withdrawals; reopening separately reports whether the billing ledger still matches the saved inspection.

Use [reviewed identity reallocation](docs/BILLING_REALLOCATION.md) to correct a wrong billing line or call while preserving original evidence and counting only the current attribution.

Use [account invoice inspection](docs/BILLING_ACCOUNT.md) to compare current statement slices across declared connections, check duplicated invoice lines and preserve unknown account/payment authority.

Use [payment evidence inspection](docs/BILLING_PAYMENT.md) to compare selected exact-invoice payment/refund documents with current invoice evidence. It initiates no payment/refund and does not authenticate settlement.

The local implementation includes durable configurable councils, one bounded cross-review round, explicit red-team comparison, durable evidence-state annotations, source-backed owner verification, non-authoritative synthesis coverage, bounded owner-selected claim memory for later runs, task images, loopback MCP result capture, paused-by-default schedules, and owner-initiated direct/PDF/browser-rendered public web capture. Runs freeze 2–6 member configurations and reuse encrypted local council templates. Remote councils can mix OpenAI, Anthropic, Gemini, Kimi, Qwen, vLLM, Ollama, LiteLLM, OpenRouter, and custom OpenAI-compatible endpoints. Each member chooses its saved connection, exact task model, reasoning level, and supported web-search mode. Provider-returned citations stay attached to the producing member or review. Analyst agreement and red-team challenges remain separate, every claim starts unsupported, and no model acts as an authority. TypeSafe/JEV remains disabled and is excluded from the active sequence.

## Requirements

- Node.js 24 LTS
- pnpm 11
- PostgreSQL 18

## Run locally

```powershell
pnpm install
pnpm db:start
pnpm db:migrate
pnpm db:branches:index
pnpm db:conversations:index
pnpm dev
```

Open `http://127.0.0.1:3000`. Save a reusable provider connection (a keyless local endpoint is also supported); it remains idle until selected. Then choose 2–6 members and set each member's connection, exact task model, supported reasoning level, optional provider-native web search, label, and role. The red-team switch adds a separately editable adversarial member and renders analyst and red-team ledgers side by side. The normal UI uses saved provider connections; deterministic fake providers remain only for offline tests and historical runs. Tasks can include up to six images or selectable-text PDFs in total. Saving or editing a connection does not itself call the provider. Separately authorized smoke tests have validated six cloud provider paths; their receipts are recorded in [LIVE_PROVIDER_VALIDATION](docs/LIVE_PROVIDER_VALIDATION.md). This Windows workspace uses a user-scoped portable PostgreSQL installation; another machine can use any PostgreSQL 18 instance by setting `DATABASE_URL` in `.env.local`.

## Verify

```powershell
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm build
```

## Workspace

- `apps/web`: Next.js interface and BFF route handlers
- `apps/worker`: separate worker process boundary
- `packages/contracts`: validated external DTOs
- `packages/domain`: provider-independent claim and report logic
- `packages/providers`: provider contract and deterministic fakes
- `packages/application`: use cases and ports
- `packages/persistence`: PostgreSQL/Drizzle schema and migration tooling
- `packages/evaluation`: offline source-support corpus validation, safety/calibration metrics, and deterministic document-clustered comparison tools
- `packages/retrieval`: SSRF-hardened, bounded public HTML/plain-text/PDF capture and extraction
- `packages/tools`: loopback-only MCP discovery and explicit text-tool invocation boundary
- `docs`: canonical product, architecture, state, decisions, and task records

See `docs/CURRENT_STATE.md` for what is working, `docs/OPERATIONS.md` for local database commands, and `docs/TASKS.md` for the concise milestone status. The detailed implementation sequence is archived in `docs/TASK_HISTORY.md`.

The [Jev assessment](docs/research/JEV_ASSESSMENT.md) led to an optional source-support review path subject to a [Turkish-first accuracy gate](docs/EVALUATION.md). Its direct TypeSafe adapter, encrypted records, worker path, routes, and shadow UI are implemented but disabled by default; no live accuracy result is claimed. The council remains independent and evidence verification stays owner-controlled. See [ADR-0017](docs/adr/0017-advisory-decision-evaluation.md).
