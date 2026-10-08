# Local accounts

Owner-requested membership, 8 October 2026. The application now requires a local
username/password session. Registration creates an ordinary user; `root` is reserved.
There is one root account, with legacy `local-owner` ownership. Existing records,
encrypted provider secrets, provenance and unknown receipts are preserved unchanged.

## Use

The entry screen has a compact mobile header and a two-column desktop layout. Both
themes show bordered 50px username/password fields, 16px input text and visible focus.
Registration includes the accepted username characters and eight-character password
minimum. **Parolayı göster/gizle** works with keyboard or pointer and retains the typed
value; switching between registration/login hides it again. Requests disable fields
and actions until completion. Errors and registration confirmation are announced in
the form. Password changes and administration fields share the visible input style.

Sign in on the application home page or choose **Yeni hesap oluştur**. Each user
manages their own provider, MCP and decision connections under **Ayarlar** and uses
their own saved API keys. Runs, conversations, private branches, templates, memory,
sources, knowledge grants/packets, preflight drafts and schedules use the same user
scope. Registration chooses a username and password; a separate display name is optional
in the API and the browser uses the username initially. Root opens **Kullanıcı yönetimi**
directly and has no council/chat workspace. It lists existing ordinary accounts, edits
username/display name, resets passwords, reviews account deletion and manages saved
connections through **Bağlantıları yönet**. Password or username changes revoke that
user's sessions. Root cannot read/create chats or run/test models, including through
direct APIs with a selected user scope. Raw API keys and password hashes are never
returned. Root's old workspace/data stays retained without an automatic transfer.

**Parolayı değiştir** requires the signed-in actor's current password (also while
root is managing another user's connections). It closes all other sessions. Logout
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

Email verification, federation and public deployment are outside
the requested local membership scope. Existing independent human-quality gates and the
two owner-cancelled billing/budget tasks remain unchanged.

## Complete account deletion

An ordinary user selects **Hesabımı sil**. Root selects **Kullanıcıyı sil** on an ordinary
account. The read-only review shows account identity, connection/run/record totals and
blockers. Confirmation requires the exact target username, the signed-in actor's current
password (root's password for administrator deletion) and the reviewed fingerprint.
The browser also requires explicit permanent-deletion acknowledgement. Root cannot be
deleted. Other ordinary users cannot inspect/delete someone else's account.

One transaction erases all target-owned application data, including API credentials,
chat/private/source originals and retained audit/usage records, all associated ownerless
children, inactive queue jobs and sessions. It retains no recoverable account tombstone.
Username reuse creates a new UUID/owner and cannot recover the deleted workspace. Root
sessions selecting the erased user return to their own scope. Other accounts stay intact.
Already taken backups, independent exports and provider-side API credentials are separate:
this operation does not selectively rewrite shared archives or revoke keys at providers.
The deletion screen states those limits before confirmation.

The complete reviewed schema/FK closure and incoming owner relationships must match.
Unknown tables/columns/FKs/delete triggers and cross-owner references block erasure.
Inspection bounds are 100,000 application/queue rows and 64 MiB serialized data; exceeding
them requires local maintenance review. Lock waits/individual statements are bounded.
Any scope change invalidates the fingerprint. Active runs/decisions/private dispatch,
active queue jobs or unacknowledged uncertain connection tests block erasure. Terminal
council/private uncertainty is erased with the explicitly confirmed full account, without
claiming a provider outcome or retrying it. Shared web/worker lifecycle leases serialize
in-flight operations against exclusive deletion, and deleted identities cannot acquire
new leases. Confirmation password attempts are limited to ten per actor per 15 minutes.

## Verification

The administration/erasure follow-up passes 460 offline, 275 isolated PostgreSQL and
53 browser cases, plus a final eleven-case account rerun, type checking, lint and a
production build. Coverage includes populated erasure, all-session revocation, stale
fingerprints, wrong passwords, root-only updates/reset, root deletion refusal, an
in-flight owner lease, schema drift and foreign-owner data/session references. Browser
coverage checks mobile self-registration/deletion and root's dedicated management,
connection editing, reset and deletion, with server-side chat denial.

Actual-installation verification registered/logged in a generated user without a display
name, saved one generated MCP connection without contacting its endpoint, inspected it
as root and erased the fixture account completely. Root chat requests return 403 and
the erased cookie returns 401. Original account inventory and existing application rows
stay identical apart from auth throttles; queue maintenance updates `pgboss.version`/`pgboss.queue` metadata.
The pre/post archives `deliberation-20261008T155943Z-93b6cb94eb10.manifest.json` and
`deliberation-20261008T160222Z-a2405f26cc67.manifest.json` both restore-verify 440 runs,
7,601 encrypted rows, 12,273 decrypted values and valid account integrity. The app remains
ready in its hidden Windows session runtime. No new migration or model call occurred.

Offline guard coverage checks every application route, concurrent owner isolation,
password derivation and runtime-token rejection. Isolated PostgreSQL tests cover
root uniqueness, privilege injection, normalized duplicate names, session hashing,
expiry/logout/password revocation, cross-owner connections, worker runs and memory.
The browser suite runs on generated migrated databases with generated root passwords
and real session cookies; it never seeds or authenticates against the personal database.
It covers registration/login/logout, root connection inspection, account switching,
stale mutation rejection and existing application regressions.

Initial membership acceptance on 8 October 2026: 459 offline tests, 271 isolated PostgreSQL tests,
all 53 browser tests, type checking, lint, production build and dependency/secret
checks pass. Personal deployment applied only migration 0055 and provisioned root;
the temporary ignored password file was removed. Live HTTP checks confirm anonymous
401, root login, unique-root inventory, all seven existing provider connections,
root connection inspection and logout revocation. The hidden Windows session runtime
reports ready. No paid generation was required.

Restore-verified pre/post archives are
`deliberation-20261008T151647Z-53c6fa90af46.manifest.json` and
`deliberation-20261008T152204Z-e60346c3ed1c.manifest.json`. Each restores 440 runs,
7,601 encrypted rows and 12,273 decrypted values; the latter also passes the account
integrity audit. Stopped-runtime database fingerprints prove that all pre-existing
tables stayed identical during migration/provisioning. The one terminal unknown
provider receipt remains retained without acknowledgement or resend.
