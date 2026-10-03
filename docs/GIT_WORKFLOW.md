# Git workflow

The primary development checkout is the local DeliberationAI application repository.
Remote: https://github.com/cnrazkl/deliberation-ai (public). Default branch: main.

## Before work

Run `git status --short --branch` and `git fetch origin`. Inspect divergence before editing.
For a clean checkout, use `git pull --ff-only`. Do not overwrite local work or force push.
Use `codex/<short-task-name>` for isolated feature branches when appropriate.
Existing worktrees contain committed snapshots; they do not automatically inherit uncommitted primary files.

## Finish a verified increment

Review the actual diff and exclude local environment files, credentials, database data,
backups, logs, exports and generated outputs. Stage explicit intended paths, inspect
`git diff --cached`, then commit with a description of the delivered scope and push.
Unfinished work must be labeled as preparation rather than accepted functionality.
The owner has requested commit/push synchronization of completed reviewed increments.
Do not fabricate old daily history, rewrite dates or create empty contribution commits.
Never reset/discard unrelated changes. If remote history diverges, inspect and reconcile first.

The Security checks workflow audits dependency vulnerabilities, installs the frozen graph
without lifecycle scripts, runs lint-dependency compatibility tests and scans full Git history
with Gitleaks on each push or pull request. Checks are not a complete application-security
assessment and do not establish functional or model-quality acceptance.

## Private local state

`.env.local`, other real `.env.*` files, `.local/`, node_modules, test outputs and build
artifacts are excluded. `.env.example` contains placeholders only. Database backups do
not include the separately managed encryption key. GitHub holds source history, not a
replacement backup of local application data.
