# Reviewed Next lint dependency mitigation — DA-103

Verified locally: 3 October 2026. Full and production-only dependency audits now
report no known vulnerabilities. This closes the DA-102 dependency finding in the
declared installed graph; it is not a complete application-security assessment.

## Reason and reviewed boundary

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) still lists
no patched braces release. Registry checks return braces 3.0.3 and micromatch 4.0.8;
even eslint-config-next / plugin 16.3.8 retains fast-glob 3.3.1. Merely upgrading
those packages does not remove the affected chain.

The installed Next 16.3.6 plugin references fast-glob only in
`dist/utils/get-root-dirs.js`. Its original
[source](https://github.com/vercel/next.js/blob/v16.3.6/packages/eslint-plugin-next/src/utils/get-root-dirs.ts)
uses `globSync` with `onlyDirectories: true` for optional `settings.next.rootDir`.
Default discovery still returns ESLint's working directory. No lint rule is disabled.

The exact parent-scoped pnpm override replaces only
`@next/eslint-plugin-next@16.3.6 > fast-glob` with `npm:tinyglobby@0.2.17`.
[tinyglobby](https://github.com/SuperchupuDev/tinyglobby) provides synchronous globbing
using fdir/picomatch instead of micromatch/braces and was already present in this lockfile.
[pnpm supports parent-scoped package aliases](https://pnpm.io/settings/dependency-resolution#overrides).
The frozen lockfile removes the entire unused vulnerable chain, without updating runtime
dependencies or the existing esbuild override. No advisory is suppressed.

An alias alone failed compatibility tests. A checked-in version-scoped pnpm patch
adapts the plugin's directory discovery: literal directories retain exact spelling and
only missing/non-directory paths return empty; dynamic paths retain absolute/relative
form, explicit relative prefixes, and the reviewed recursive-root behavior. Directory
expansion is disabled, directory terminators are normalized and static/brace-expanded
recursive bases are excluded without pruning their children. This patch does not alter
rule implementations, defaults, ESLint config or application/provider execution.

The substitution is deliberately specific to this plugin/utility. It is not an
implementation of fast-glob's entire API or a universal equivalence claim for every
possible filesystem, symbolic-link layout or glob expression. The compatibility
suite protects the exercised project/monorepo patterns; extending the consumer needs review.

## Reproducibility and maintenance

Run `pnpm install --frozen-lockfile`, then `pnpm test:lint-dependencies` and `pnpm lint`.
The install authenticates the checked-in patch hash. `.gitattributes` fixes patch files
to LF so Windows and Linux checkouts use identical bytes. Tests reject patch/hash drift,
an unexpected plugin version, extra glob consumers, an unreviewed replacement version,
reintroduced vulnerable packages or changed settings for any of the 113 enabled rules.

Before upgrading Next lint, review the upstream dependency graph and utility again.
Remove both the alias and patch together only when a compatible upstream version removes
the finding; deliberately review/rebaseline the compatibility suite. Re-run frozen clean
installation, full audit, lint, type checks and build. Do not mute a regression to get green.
The original braces advisory remains an upstream problem even though this graph omits it.

Security CI retains the full moderate-or-higher audit and full-history Gitleaks scan,
and adds frozen installation with lifecycle scripts disabled plus compatibility tests
on Linux/Node 24. A failed install or compatibility test fails the workflow.

[Verification](DA103_ACCEPTANCE.md), [decision](adr/0030-next-lint-glob-mitigation.md),
[historical finding](DEPENDENCY_SECURITY_2026_10_03.md).
Next product increment: reviewed preflight draft content deletion/replay protection.
