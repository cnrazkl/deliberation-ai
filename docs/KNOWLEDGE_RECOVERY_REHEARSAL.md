# Generated knowledge upgrade and rollback rehearsal

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
A real cutover requires reconciling those later changes before enabling access/jobs;
this rehearsal does not automate reconciliation. No worker starts against the restored
databases and no provider operation is resumed.

Pre-upgrade/restored reads use current code's compatible storage APIs; no historical
application executable is launched. This is local PostgreSQL/migration/archive
evidence only. Clean-machine setup, old-binary compatibility/fencing, actual cutover,
later-data reconciliation, month-long maintenance and human/model quality/cost remain
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
