# Worker migration history gate

Before queue initialization, job registration, schedule dispatch or heartbeat creation,
the worker performs a read-only bounded query of drizzle.__drizzle_migrations.
Its ordered logical migration timestamps must exactly match the bundled journal:
missing, additional, duplicate, substituted or unreadable history blocks startup.
The query has a five-second client timeout and reads at most expected count plus one.
Existing connection timeout remains. Logs expose only a fixed operator explanation
and error class; SQL, connection details and database errors are not printed.

Run `pnpm db:compatibility:check` for the same read-only gate without starting a queue.
A matching result does not apply a migration, verify ciphertext, certify schema DDL,
compare SQL byte hashes or approve resumption of restored work. SQL newline/platform
differences therefore cannot become incompatible SQL-hash claims. This is logical
journal matching, not general database integrity or release compatibility certification.

Stop web and workers before changing application/database versions. On mismatch,
check the selected source revision and database; use separately authorized backed-up
migrations or a reviewed compatible replacement snapshot. Do not edit the ledger to
bypass the check. There is no automatic migration, downgrade, restore or provider retry.
This gate runs once at worker startup; it cannot protect already running processes
from an in-place schema change. Web APIs and operator/storage scripts are not globally
fenced by it. Historical binaries predating this change cannot acquire the gate.

Two offline tests cover current and simulated older manifests plus invalid histories.
A generated-only PostgreSQL test launches the actual current worker with behind/ahead
ledgers and requires exit 1 with unchanged queue inventory/configuration and heartbeat
count. It restores exact fixture ledger rows in finally; it refuses personal database
targets before writes. The populated recovery rehearsal also denies baseline/rollback
0053 history and accepts current/forward-migrated 0054 history. No old executable is
launched and no provider call is authorized. Broader [DA-126 acceptance](DA126_ACCEPTANCE.md)
and [cutover reconciliation](KNOWLEDGE_RECOVERY_REHEARSAL.md) remain open.
