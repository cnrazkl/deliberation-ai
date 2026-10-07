# Windows session runtime and console lifetime

On 8 October 2026 the owner reported repeated outages and supplied the visible
`next-server` and Node terminal windows. The owner confirmed that closing those
windows stopped the app. PostgreSQL stayed on 5432. The previous verification
showed readiness only while the process pair was alive; it did not establish
independence from these console windows. A host turn/job teardown was initially
suspected, but the owner report establishes the window-close trigger instead.

The old `detached: true` launch gave each Windows role its own console, despite
the requested hidden mode. Node documents this detached Windows behavior in
[its child-process reference](https://beta.docs.nodejs.org/child_process/asynchronous-process-creation#optionsdetached).
The web/worker pair now inherits the hidden supervisor console and never requests
a detached console. Default `pnpm app:start` invokes a held current-user Windows
Task Scheduler action, rather than a short-lived launcher. The action ends after
the pair stops; an unexpected role exit stops the other role and records failure
without retry. The original-runtime rollback of the replacement rehearsal uses
the same session launcher; temporary clone phases remain owned by the rehearsal.

## Operating boundary

- `pnpm app:start`: register/start the owned on-demand session task, then wait for
  a new matching runtime identity, ready DB and exactly one ready worker. A live
  TCP listener blocks another launch even if diagnostics are slow.
- `pnpm app:status`: read readiness and owned task state/result. A running task is
  separate from successful HTTP/database/worker readiness.
- `pnpm app:stop`: require readable diagnostics without known pending/uncertain
  work, mark the exact stop identity, stop only matching process trees and wait
  for the task to finish. PostgreSQL/history are retained.
- `pnpm app:remove-launcher`: remove only the stopped owned task definition.
  It never removes data, credentials, backups or exports.
- `pnpm app:verify-lifetime`: opt-in Windows lifecycle probe, requiring a stopped
  port 3000 and existing owner configuration. It starts the application from a
  disposable kill-on-close Windows job, validates the native job policy, forcibly
  closes that job, then checks the same runtime twice. The app remains running.

The task has no login/reboot/timer trigger, automatic crash restart, elevation or
stored account password. It runs only in the current logged-on owner's context.
Task names bind the normalized checkout path. Reuse/removal verifies action,
arguments, directory, owner SID from stored XML, interactive/limited principal,
empty trigger inventory and fixed lifetime/restart/instance settings. An altered
definition is refused. A stopped owned definition is refreshed before a new start.
[Microsoft security context](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks)
and [task settings](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset).

The scheduler receives the canonical physical local data root, because an MSIX
process can see `LOCALAPPDATA/DeliberationAI` through virtualization while an
unpackaged action cannot. No secret environment values enter task arguments or
registration. The action reads the existing ignored `.env.local`; no config/key
copy is created. Logs, process identity, content-free exit/stop/supervisor records
and lifecycle proof stay in ignored `.local/runtime/`.

## Verification

The actual final Windows probe closes the generated job and confirms its launcher
exits. Two subsequent real-route checks retain the same web/worker identity,
HTTP 200, ready database and exactly one worker. Original pending/uncertain
application work and active schedules are zero; 29 backup metadata entries remain
visible through the physical data path. No provider calls, migration, database
restore-over or owner deletion occurs. This proves survival of the tested launcher
job closure; it does not certify crash/reboot/login recovery or prolonged uptime.

420 unit cases/73 files pass. Full workspace/scripts typechecking and zero-warning
lint pass; both PowerShell scripts parse successfully. Startup, status, requested stop and
restart are exercised on Windows. An early probe failed to apply kill-on-close
through a nested value struct; the corrected probe reads the actual native limits
before it accepts teardown evidence. Only the subsequent successful check counts.
An altered owned task definition and removal of a running task are both refused;
the original definition is restored and the same ready application stays running.
