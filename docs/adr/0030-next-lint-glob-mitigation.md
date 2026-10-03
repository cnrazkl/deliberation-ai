# ADR-0030: scope the Next lint glob replacement and preserve its consumer behavior

Status: implemented and locally verified, 3 October 2026.

The reviewed high-severity braces advisory has no available fixed release. Next lint's
fast-glob dependency introduces that package, while newer published Next lint packages
still use the same chain. Ignoring the advisory would leave the dependency gate open.

Replace only the exact Next 16.3.6 plugin dependency edge with pinned tinyglobby 0.2.17.
Keep all rule implementations and configured settings. Alias-only compatibility failed;
therefore apply a checked-in, lock-hashed patch to the single directory discovery utility
to preserve the exercised literal/path/recursive-root semantics. No general fast-glob API
compatibility or complete security guarantee is inferred from this bounded substitution.

Require installed-graph/consumer checks, all-rule settings fingerprint, directory discovery
and actual lint violations, bounded malformed-pattern checks, frozen clean installation,
full audit, normal lint/type/unit/build checks and remote Security CI. Keep patch bytes LF.
The workflow adds compatibility gates while preserving dependency and full-history scans.

This introduces a local tooling maintenance obligation. A Next lint upgrade must explicitly
review/remove or adapt both alias and patch, rebaseline intended settings and repeat checks.
Prefer a compatible upstream removal/fix once available. No provider/runtime or database
behavior changes, advisory exception, lifecycle-hook exception or global tool upgrade occurs.

[Policy](../DEPENDENCY_MITIGATION.md), [evidence](../DA103_ACCEPTANCE.md).
