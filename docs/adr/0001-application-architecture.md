# ADR-0001: Application architecture

Status: accepted on 17 September 2026

## Decision

Use a TypeScript pnpm workspace with a Next.js BFF, a separate Node worker, PostgreSQL/Drizzle, and pg-boss. Keep contracts, domain rules, application use cases, providers, and persistence in separate packages.

## Consequences

The first deployment has two processes and one database. Long model calls never hold a database transaction. Provider SDKs cannot become domain types. A heavier workflow engine is reconsidered only for multi-day human approvals or cross-service orchestration.
