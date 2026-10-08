# Local accounts

Owner-requested membership, 8 October 2026. The application now requires a local
username/password session. Registration creates an ordinary user; `root` is reserved.
There is one root account, with legacy `local-owner` ownership. Existing records,
encrypted provider secrets, provenance and unknown receipts are preserved unchanged.

## Use

Sign in on the application home page or choose **Yeni hesap oluştur**. Each user
manages their own provider, MCP and decision connections under **Ayarlar** and uses
their own saved API keys. Runs, conversations, private branches, templates, memory,
sources, knowledge grants/packets, preflight drafts and schedules use the same user
scope. Root's **Kullanıcı yönetimi** lists accounts and connection summaries and can
open any user's entire workspace. A visible banner identifies the selected account;
**Root alanına dön** restores root's workspace. Switching/logging out closes the
current page's unsaved draft. Root can also create ordinary users. Raw API keys and
password hashes are never returned to either account management or connection UI.
Root can use/edit connections through the selected workspace without exposing keys.

**Parolayı değiştir** requires the signed-in actor's current password (also while
root is viewing another user's workspace). It closes all other sessions. Logout
revokes the current session. Sessions last eight hours, with no sliding renewal.
Users are local to this installation; internet/LAN hosting is not part of this change.

## Provisioning and migration

Migration `0055_aspiring_multiple_man.sql` adds three account tables only. Stop all
web/workers, verify host quiescence, take and restore-verify a backup with its separate
encryption key before applying it to personal data. There is no automatic migration.
Provision root with `pnpm accounts:root <absolute-private-password-file>`; create the
password file outside Git (for example under ignored `.local/`) and remove it after
successful provisioning. The requested password is supplied locally, never a source
constant/default or command-line password. Re-provisioning verifies an existing root;
it never silently changes its password. Registration is unavailable before root exists.

Normal `pnpm app:stop` retains the unresolved-outcome guard. Explicit
`pnpm app:stop --maintenance` permits preserving terminal unknown council receipts
during version replacement, but refuses active council/decision/private jobs,
active schedules, active queue work and unacknowledged connection probes across
**all** users. It neither acknowledges receipts nor authorizes retries. Recheck the
database after stopping and before migration; a concurrent write invalidates quiescence.
Keep unknown outcomes visible after restart and inspect before any explicit retry.

Backups contain salted password hashes and hashed session records as well as encrypted
application data; protect the whole archive. Restore verification is read-only. Before
a real restored installation resumes service, invalidate all restored `local_sessions`
as an explicit maintenance step so previously revoked browser cookies cannot revive.
Preserve accounts/password hashes and reconcile later account changes before cutover.
An old binary and a post-0055 database are not a compatible rollback pair.

## Boundaries

Password derivation uses salted scrypt (N=32768, r=8, p=1, 64-byte key). Sessions use
32 random bytes; only SHA-256 token hashes are stored. The cookie is HttpOnly,
SameSite=Strict, path `/`, with Secure on HTTPS. Requests validate the configured
Host and same-origin headers; session responses and application responses use no-store.
Authentication JSON streams are bounded to 2 KiB. Usernames normalize to lowercase,
3–32 ASCII characters; passwords are 8–128 characters. Registration is limited to
60/hour, total accounts to 500. Login is limited to 120/minute globally and ten per
username per 15 minutes; password-change checks have their own limit. Unknown users
perform the same password derivation and receive the same login rejection.

Web instrumentation forbids implicit ownership. A central guard binds the DB session's
selected account in AsyncLocalStorage; HTTP cannot supply an arbitrary owner. Mutation
headers and SSE owner bindings reject stale account scopes with 409. The client remounts
the workspace on account changes and notifies other tabs; focus/30-second checks handle
expiry. Already displayed data or exported files cannot be recalled by logout.
Queues derive ownership from persisted run/branch/assessment targets, never queue input;
schedule scanning binds each persisted owner. Provider adapters receive only that owner's
credentials. Host DB/key administration remains trusted and retains legacy root scope.
Machine-key HMAC tokens permit only a 15-second diagnostic GET for hidden runtime health;
they cannot create sessions, select users, mutate application data or call providers.

Account deletion/reset, email verification, federation and public deployment are outside
the requested local membership scope. Existing independent human-quality gates and the
two owner-cancelled billing/budget tasks remain unchanged.

## Verification

Offline guard coverage checks every application route, concurrent owner isolation,
password derivation and runtime-token rejection. Isolated PostgreSQL tests cover
root uniqueness, privilege injection, normalized duplicate names, session hashing,
expiry/logout/password revocation, cross-owner connections, worker runs and memory.
The browser suite runs on generated migrated databases with generated root passwords
and real session cookies; it never seeds or authenticates against the personal database.
It covers registration/login/logout, root connection inspection, account switching,
stale mutation rejection and existing application regressions.
