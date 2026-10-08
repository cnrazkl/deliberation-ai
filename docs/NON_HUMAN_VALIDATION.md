# Non-human execution and isolated remote validation

8 October 2026. The owner requests all remaining non-human work and authorizes an
SSH-accessible shared host only through a new directory/image and isolated Docker
project. Existing Docker components and PostgreSQL databases must not be changed,
queried, restarted, migrated or pruned. Cloudflare/public hosting is a possible later
step, not part of this verification.

## Full-cohort diagnostic

`pnpm study:diagnostic --live <unused-name> <absolute-config-json>` validates exactly
two frozen study selections and two saved local connection identities. Each selection
contains the existing `kind`, `caseIds`, `memberCount`, `maxCalls`, `outputTokens`
and optional `maxConcurrentArms` (1–4). A used identity cannot resume or resend.
The command only reads the source installation's saved connections. It provisions a
random `da_study_*` database, new encryption key, disabled generated root credential,
ordinary study user, independently encrypted connection copies and a dedicated worker.
No source run, queue, schedule, credential or account is written.

The full existing cohort has 40 cases, 145 eligible 0/1/2/3 round arms (770 planned
calls with two members) and 80 original/additive prompt arms (320 planned calls).
High-risk zero-review exclusions and fixed output ceilings remain. Native OpenAI and
DeepSeek saved targets are frozen for this diagnostic; no unavailable target is
silently substituted. Four concurrent arms and four generated worker slots are
explicitly frozen. Their enqueue-to-observation durations include queue competition
and polling; they cannot establish isolated model latency, a causal effect of more
rounds or accuracy. Fixed ordering is retained rather than claimed randomized.

Current `study-dispatch-v4` preparation requires an explicit live ordinary `ownerId`
and persists its fixed review policy for comparison with actual worker prompt records.
An older worker cannot silently supply different review instructions; policy mismatch
is retained and blocks later arms.
Root, missing/deleted users and foreign connections cannot dispatch. Owner lifecycle
leases fence account erasure. Historical v1/v2/v3 final observations remain readable and
terminal replay makes no new call; unstarted old preparations need new owner-bound
preparation. Source/connection drift, unknown submission and polling timeout block
later work. Authentication/payment/model/rate rejection also stops new arms; already
started bounded arms settle and remain inspectable. No automatic retry is introduced.
Complete case selection is separate from observed/completed arm coverage.

Encrypted journals, generated database and separate ignored private environment are
retained for inspection/independent review. Do not drop a study database without
reviewing its unknown receipts and separately preserving its encryption key. Local
previews are explicit plaintext public-source snapshots outside database backups.
Missing tokens/cost remain unknown. Independent claim/drift/contradiction/synthesis
judgments, corpus representativeness and semantic acceptance remain excluded.

## Separate-host rehearsal

`deploy/rehearsal/Dockerfile` builds a new Node 24 image with the frozen dependency
graph, strict type checks and production build. `deploy/rehearsal/compose.yaml` requires
a unique image, Compose project, generated database, generated credentials/encryption
key, reviewed source-tree hash and unused HTTP port. The PostgreSQL service has its
own volume and no published port. Database/worker/observer use the project's internal
network; web additionally uses a second new project-owned bridge for host-loopback
publication, or explicitly selected private-LAN publication via `REHEARSAL_BIND_IP`.
The same selected IP supplies `APP_ORIGIN`; exact Host/Origin checks are not bypassed.
Docker cannot publish a reachable port through an internal-only network.
Neither network is shared with existing services. No host bind mounts, Docker socket,
external volumes, public endpoint or existing-service restart is configured.
Compose project separation and explicit host-IP publication follow
[Docker project naming](https://docs.docker.com/compose/how-tos/project-name/) and
[port publishing](https://docs.docker.com/engine/network/port-publishing/).

Before starting, record existing container IDs/start times/restart counts and confirm
the proposed port is unused. Transfer a reviewed source archive without `.env*`,
`.local`, dependency/build trees, credentials or personal DB archives. Build only the
new tag and operate only with its exact `-p <new-project> -f <new-compose>` identity.
Run integration tests before starting workers in the generated test database; then
create a separate fresh application database in this new PostgreSQL container and
apply migrations only there. Never use global Docker cleanup or stop commands.

The smoke command checks actual production web/worker/database readiness, anonymous
denial, root administration/chat denial, ordinary registration/login, a complete fake
council/review round, cross-user isolation, complete generated-account erasure and
session revocation. It accepts only `db/deliberation_rehearsal_<12-hex>` database
identities. Its root password is privately provisioned, never part of the image/source
or normal web/worker environment. It makes zero provider calls. Recheck the original
container inventory afterward. Linux/Docker evidence does not certify a clean Windows
OS/prerequisite installation or public deployment.

The Docker integration configuration explicitly excludes one native Windows
portable-PostgreSQL archive harness. It remains required and passed in the ordinary
Windows suite. Six initial Linux failures came from an incorrectly sized generated
database identity; using the required sixteen hexadecimal characters permits those
checks without changing their guards. The initial logs remain retained. Docker
separately verifies a populated synthetic encrypted connection/account
archive using `pg_dump`/`pg_restore` inside only the new database container. Source and
restored table definitions/rows must match; restored account hashes/scopes and every
encrypted column are audited. Only `db/deliberation_recovery_<12-hex>` and a matching
new `deliberation_restored_<12-hex>` target are accepted. No provider call is made.

## Thirty-day operating observation

The separate `observe` service samples production HTTP and signed content-free
database/worker readiness every 15 minutes for 30 actual days. It stores a frozen
source-tree/window plan and immutable successful/failed timestamped samples in its
own observation volume. It sends no provider requests and restarts no service.
`node --import tsx packages/persistence/scripts/operating-study.ts status <observation-name>`
reports the due date, sample coverage, unhealthy samples and missing intervals.
The current owner-selected LAN name is `month-lan-20261008`; its actual window runs
from 8 October to 7 November 2026 at 21:57 Istanbul. Earlier `month-v8` and setup
observations remain separate and retained; changed source/address never overwrites them.

A short session cannot pass the month. A completed calendar window with gaps is
reported as incomplete. Sampled availability never implies continuous uptime, and
unrecorded routine maintenance minutes stay unknown; the 30-minute/month duty target
still needs actual complete timed work records. Independent human quality is always
`not_assessed`. This collection starts the external observation instead of replacing
it with synthetic timestamps or marking it passed early.

## Results

Execution results and final verification are recorded in `CURRENT_STATE.md` and
`TASKS.md` after the actual runs; preparation alone does not close their gates.
