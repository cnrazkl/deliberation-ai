# DA-107 acceptance

Verified 3 October 2026 in the primary local repository.

- 274 unit tests pass; strict deletion acknowledgement and content-free receipt contracts included.
- 185 isolated PostgreSQL integration tests pass across 22 files. New cases cover creation retry/conflict, paused-only review, exact microsecond drift, stale worker snapshots, concurrent dispatchers, retained queued runs, transactional cursor rollback, schema/FK/owner drift, legacy null identity, corrupt receipt rejection, and the existing-run preflight tombstone retry path.
- Full browser acceptance: all 29 cases pass in the final complete sweep. The first sweep passed 27 and identified two obsolete callers: immediate DELETE and a schedule POST without the newly required request identity. Those cases were adapted without weakening risk/error checks, then the full suite was rerun.
- Workspace TypeScript checks, zero-warning lint and separate-output production build pass. The running development server and its output directory were preserved.
- Full dependency audit reports no known vulnerabilities. Gitleaks finds no secrets in the staged source export. Full-history scan and the remote Security workflow are publication gates.
- A populated custom pg_dump archive of generated-only schedules was restored with pg_restore to another disposable database. Encryption/receipt validation, identical confirmation replay, original creation replay rejection and hidden/no-dispatch tombstones pass. Both scratch databases were removed; primary data was not restored over.
- Reviewed additive migration 0048 is applied locally and recreated in isolated acceptance databases. No real owner template was deleted and no cloud/paid provider call was used. Browser provider behavior used loopback fixtures only.

The implemented boundary removes one paused recurring template's encrypted content; independently frozen run content/accounting, backups/WAL and external copies remain. Legacy original creation identity is unknown. More than 1,000 related occurrence-run IDs or unsupported schema blocks inspection. This is not universal deletion, queued-run cancellation, monetary settlement or semantic/model-quality acceptance.

Next: DA-108 reviewed saved council-template deletion and creation retry boundaries. [Contract](LOCAL_SCHEDULE_DELETION.md).
