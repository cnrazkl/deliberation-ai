# DA-103 verification — remove the vulnerable Next lint glob chain

Verified locally: 3 October 2026, primary repository
`C:\Users\caner\Projects\DeliberationAI`, Node 24.19.0.
The primary CLI currently runs pnpm 11.25.0; a separate clean source export was installed
and tested using the repository-declared pnpm 11.19.0. No global tool upgrade was made.

| Local check | Result |
| --- | --- |
| Full `pnpm audit --audit-level moderate` | No known vulnerabilities reported |
| Production-only dependency audit | No known vulnerabilities reported |
| Frozen primary installation with lifecycle scripts disabled | Passed |
| Clean source export, pnpm 11.19.0 frozen install without lifecycle scripts | Passed |
| `pnpm test:lint-dependencies` | All 7 cases passed in both installations |
| Comparison with the original cached fast-glob 3.3.1 | All 38 bounded path examples agree |
| `pnpm test` | 272 tests / 41 files passed |
| Workspace type checks / zero-warning lint | Passed |
| Separate `.next-verify` production build | Passed |
| Local staged-source Gitleaks scan | Passed; no leaks reported |

The seven cases check actual installed dependency identity and patch/lock hash, exclusive
plugin consumption of the reviewed directory interface, literal/relative/absolute/Windows
paths, hidden directories, files/missing paths, prefixes/trailing separators, brace/extglob
and recursive directory sets, complete 113-rule settings fingerprint, actual Pages/app
root discovery and internal-anchor violations across monorepo roots, and bounded child
process handling of 1,000/3,000 nested braces through both replacement and patched utility.
The controlled nested-pattern test is not a general denial-of-service resilience certificate.

Before replacement, the original graph passed the interface/path/rule/anchor baseline.
The first anchor fixture assumed nested App Router detection that the existing upstream
rule did not perform; it was corrected to supported Pages routes and App Router homepages
before the baseline passed. The alias alone then exposed directory-expansion/path-format
differences. Additional original-versus-replacement comparisons exposed recursive base,
relative-prefix and trailing-separator differences; the reviewed patch and permanent cases
address them. Neither rule settings nor application behavior were relaxed to make tests pass.

Only the Next lint dependency edge and unused chain change in the lockfile; runtime
dependencies, existing esbuild override and model tests remain unchanged. Database/browser
suites were not rerun for this tooling-only increment. Their DA-102 results remain historical
evidence, not new DA-103 test executions. No migration, owner-data deletion, paid model call,
JEV activation or primary cache erasure ran.

Security CI still enforces the full audit and full-history secret scan. It additionally
installs the frozen graph without lifecycle scripts and runs compatibility tests on Linux.
Published-head Actions status is the authoritative remote result; local audit success
alone does not establish a successful CI run or complete application security.

[Policy and maintenance](DEPENDENCY_MITIGATION.md),
[ADR](adr/0030-next-lint-glob-mitigation.md). Next: reviewed preflight draft deletion.
