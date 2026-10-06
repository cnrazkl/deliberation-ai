# Clean source installation rehearsal

Run `pnpm knowledge:install:rehearse` after explicitly staging the reviewed source
increment. Unstaged tracked edits are refused. The command archives the exact Git
index tree into a generated `.local/clean-install-verification/<uuid>/checkout`.
It refuses source symlinks and private environment/local/dependency paths, and
checks that `.env.local`, `.local`, `.git` and `node_modules` were not copied.
Untracked working files are excluded. The reported tree hash identifies source,
not a historical commit or release acceptance.

Child processes receive only operating-system path/temp settings and generated home/
appdata/config paths. Application credentials and database environment are not
inherited. A previously absent generated package store is used with
`pnpm install --frozen-lockfile --ignore-scripts`; no lifecycle build scripts run.
Dependency downloads require the normal public registry and network. No provider
request, PostgreSQL setup/migration or personal runtime configuration is performed.

The clean copy runs frozen knowledge status, actual binary extraction verification,
unit tests and lint-dependency compatibility checks. Each successful step reports
elapsed wall time; installation/download time remains separate from later checks.
Failures expose a fixed phase only, without subprocess logs or sensitive content.
The generated checkout, store, home and archive are deleted after success/failure;
cleanup checks the resolved parent and UUID identity first.

This verifies source/dependency installation and offline checks on the existing host.
Node, pnpm, Git, tar, operating system and network already exist. It does not install
those prerequisites, time full owner setup, start a restored database, test a separate
machine, establish the 30-minute setup target or measure monthly maintenance.
Human/model quality, old executable compatibility and actual cutover remain open
under [DA-126](DA126_ACCEPTANCE.md).

6 October local observation: source tree
f50b06e496961ab0c767babeb7a7c92c076a5367, Windows, Node 24.19.0, pnpm 11.25.0.
Fresh-store download/install: 53,946 ms. Status: 1,451 ms; extraction: 1,612 ms;
390 passing unit cases: 6,222 ms; lint compatibility: 4,118 ms. These exclude source
export and cleanup and do not establish complete owner setup time. Workspace type/
lint, syntax and full dependency audit also pass. Unexpected arguments are refused.
An intermediate failed attempt is not positive evidence; color codes are stripped
before parsing the test-count summary. Generated files were cleaned after each run.
