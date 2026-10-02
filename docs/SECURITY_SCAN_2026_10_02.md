# Source publication security checks — 2 October 2026

Scope: first publication of the existing local application source, documents and tests
at https://github.com/cnrazkl/deliberation-ai. Application behavior was not changed.
DA-096 remains the last documented accepted increment. The partial private-delivery
backend is included as work in progress; publication is not acceptance of that feature.

## Checks

- `pnpm audit --audit-level=moderate`: no known vulnerabilities reported by the registry.
- Gitleaks v8.30.1 scanned the Git-eligible publication files with default rules.
  Three initial generic-key findings were reviewed: one `operation-123` idempotency
  fixture and two uses of the identical `sk-test-secondary-never-sent-1234567890`
  synthetic key in offline tests. The config allows only those exact values.
  The repeat passed with no remaining findings.
- Existing Git history passed Gitleaks. The complete publication commit is scanned
  again before push and by the GitHub workflow afterward.
- Four sensitive configured local environment values were compared against eligible
  text files without printing the values: no exact matches.
- Ignore checks confirmed exclusion of root/web environment files, local backups,
  dependencies, test outputs and compiler state. `.env.example` remains included.
- The original AGPL-3.0 license was restored rather than publishing its staged deletion.

## Limits and follow-up

This is a source-publication secret/dependency check, not a penetration test, complete
security audit, empirical model evaluation or acceptance of unfinished backend work.
The application still uses a loopback/single-local-owner boundary; public source
hosting does not authorize public application deployment.

The Security checks workflow runs on pushes and pull requests with read-only repository
permissions and commit-pinned actions. It repeats dependency audit and scans full Git
history. A clean result cannot guarantee absence of all secrets or vulnerabilities.
Future completed reviewed increments follow `GIT_WORKFLOW.md` with meaningful commits
and push verification. Existing development dates are not reconstructed or backdated.