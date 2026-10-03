# Dependency audit finding — 3 October 2026

Status: historical DA-102 finding, resolved in the declared dependency graph by
[DA-103](DEPENDENCY_MITIGATION.md). Full and production audits now pass without
ignoring this advisory. The discovery snapshot below records the original failure;
the upstream braces advisory itself remains unresolved.

The original full `pnpm audit --audit-level moderate` failed on one high-severity advisory:
[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The current reviewed advisory affects `braces <=3.0.3` and lists no patched release.
The upstream [issue](https://github.com/micromatch/braces/issues/70) describes unbounded
recursive AST traversal for deeply nested brace patterns under its character limit.
The advisory was reviewed/updated on 2 October; prior clean audit snapshots are historical.

The installed dependency path from `pnpm why braces` is:
`apps/web devDependencies -> eslint-config-next@16.3.6 -> @next/eslint-plugin-next@16.3.6
-> fast-glob@3.3.1 -> micromatch@4.0.8 -> braces@3.0.3`.
Registry checks still return braces 3.0.3 as latest and fast-glob 3.3.3. The latest
fast-glob version alone does not establish a patched braces release. No blind
transitive override is applied.

`pnpm audit --prod --audit-level moderate` reports no known vulnerabilities in the
production dependency graph. This narrows the observed dependency path to lint tooling;
it does not make the full audit clean, prove non-exploitability or certify the application.

No advisory suppression, security-workflow change, unreviewed fork or local dependency
patch was introduced in DA-102. Full GitHub dependency audit remains a failing gate;
local full-history/staged secret scans are recorded separately. Functional deletion
tests do not close this dependency finding.

Next: adopt and verify an upstream fixed release when available, or separately review
a maintained compatible lint dependency replacement/mitigation with regression evidence.
Preserve the full audit and document any proposed exception before treating it as accepted.
