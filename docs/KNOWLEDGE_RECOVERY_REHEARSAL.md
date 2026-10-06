# Generated knowledge upgrade and rollback rehearsal

6 October follow-up: the explicit synthetic reconciliation below passes on the
patched dependency graph. 390 unit cases / 61 files, 249 isolated PostgreSQL cases /
30 files, typecheck, lint, production build, seven lint-dependency checks and full
dependency audit pass. Native sharp PNG and actual MCP SDK synthetic loopback
discovery/call also pass. No real cutover or human decision is inferred.

Run `pnpm knowledge:recovery:rehearse` on the provisioned Windows loopback PostgreSQL
installation. It uses the locally managed encryption key but creates only synthetic
records in three randomly named databases. It never dumps, migrates, restores over,
or deletes the owner's database. Provider mode is fake and fetch calls are forbidden.

An ignored temporary migration inventory through 0053 creates a populated fixture
with TXT/selectable PDF/scanned PDF/image originals, historical versions, selection/
grant, a reviewed packet, completed fake run and reviewed candidate. The command
takes a custom-format pre-upgrade archive, applies actual migrations through 0054,
and checks exact source-version ciphertext, collection/selection exports, candidates
and historical run packet. A migration inventory no longer ending at 0054 is refused;
review the rehearsal explicitly when another migration is introduced.

It exercises local reusable save and acknowledged manual handoff, rejects/stales
the original candidate, revokes the grant and restores the current archive into a
second database. Exhaustive encryption audit, immutable historical quote/packet/
candidate/publication equality and revoked-scope denial remain checked. Renewed grants
can inspect old originals and latest lexical sources; scan/image stays unverified.

It restores the pre-upgrade archive into the third database. The ledger must end at
0053 and the publication table must be absent. Encryption audit, baseline versions,
collection/selection exports, candidates, original bytes, scope authorization and
historical packet must match the pre-upgrade snapshot. Generated databases, archives
and migration inventory are removed; the rehearsal restores its original environment.

Rollback means replacement from the pre-upgrade snapshot, not in-place downgrade.
Publication receipts/copied sources and grant revocations after that snapshot are
absent by design. The baseline active grant reappears and is checked as active.
A real cutover requires reconciling those later changes before enabling access/jobs.
The rehearsal now explicitly reapplies only its known synthetic revocation and
rejected/stale candidate review through existing revision-checked APIs. A stale grant
update, old reads/search and packet loading are refused; candidate provenance survives.
Forward migration to 0054 leaves missing publication receipts absent, with neither
local nor manual publication preview permitted for that candidate. Explicit synthetic
grant renewal still leaves the old selection/packet unavailable. A fresh selection
and newly prepared/reviewed packet can be loaded, while the old packet remains denied.
Historical run packet and encrypted source versions stay intact; a final exhaustive
encryption audit checks the reconciled database. This fixed fixture sequence does
not discover all lost changes or authorize real renewal/replay. No worker starts against the restored
databases and no provider operation is resumed.

Pre-upgrade/restored reads use current code's compatible storage APIs; no historical
application executable is launched. This is local PostgreSQL/migration/archive
evidence only. Clean-machine setup, old-binary compatibility/fencing, actual cutover,
complete later-data reconciliation, month-long maintenance and human/model quality/cost remain
open under [DA-126](DA126_ACCEPTANCE.md). Keep production archives and keys separate
as described in [operations](OPERATIONS.md).

Local checks: upgraded/rollback mode and standard current restore mode pass, including
exhaustive encryption audits and cleanup. 390 unit cases / 61 files, workspace/scripts
typecheck, zero-warning lint and dependency audit pass. An existing assertion assumed
the first lexical hit was the updated original; reusable save adds another matching
source and UUID order can put that copy first. The verifier now checks the original
source ID and explicitly requires the matching copy too. Earlier failed rehearsal
attempts are not acceptance evidence; they exposed this verification defect. Failure
messages now identify a fixed phase name without printing content or credentials.

Implementation `5058bc2` is on remote main;
[Security checks 37456850603](https://github.com/cnrazkl/deliberation-ai/actions/runs/37456850603)
passed. All 852 documentation links and staged/full-history secret scans pass. The
Windows PostgreSQL rehearsal is local evidence, not a GitHub CI job. At 14:30
Istanbul, application database and one worker were ready with no queued/running runs
or unresolved attempts; the generated archive directory was empty.
