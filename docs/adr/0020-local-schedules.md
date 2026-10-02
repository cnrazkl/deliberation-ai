# ADR-0020: Local schedules

Status: accepted and implemented on 22 September 2026.

## Decision

A local schedule freezes its question, provider mode, review count and complete member configuration under context-bound encryption. Daily and weekly cadences are supported. Creation always produces `paused`; the owner must explicitly activate, pause or delete it.

The existing worker scans due active schedules at startup and every 30 seconds. Each occurrence uses `schedule:<schedule-id>:<scheduled-time>` as the durable run idempotency key, records the resulting run id and advances from the scheduled occurrence time. If the computer or worker is off, the next startup queues the overdue occurrence.

## Consequences

No new scheduler service or cloud dependency is introduced. Model API calls can occur only while the local worker is running and only after the owner activates the schedule. Existing provider receipts and unknown-outcome rules still apply to every scheduled run.
