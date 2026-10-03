# ADR-0031: Reviewed preflight draft content deletion

Status: accepted. Date: 3 October 2026.

Preflight drafts already scrub their encrypted bodies after start or legacy cancellation, but lacked a reviewed deletion boundary and a durable confirmation receipt. Removing the row would free the original idempotency key and let a delayed submission restore private content.

Retain the existing row as an owned cancelled tombstone. Replace its fixed clarification JSON with a strict content-free receipt and clear both ciphertexts atomically under owner/table serialization. Bind owner review to an exact PostgreSQL row fingerprint, inspect the schema/FK/trigger/unique-index boundary and refuse stale or oversized inputs. Reuse this tombstone in ordinary enqueue/rerun guards, and preserve any independently running council.

This uses no migration and adds no ciphertext column. The receipt is intentionally plain metadata; sensitive content and provider usage are not copied into it. Matching confirmation replay and restored metadata validation remain available. Old pre-deletion backups, separate source records, existing run bodies and physical storage remain outside scope. See [the contract](../PREFLIGHT_DRAFT_DELETION.md).
