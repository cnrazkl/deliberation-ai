/** Reuse an intent's key until its response is read; a lost response is not a new intent. */
export class SubmissionAttempts {
  #attempts = new Map<string, { payload: string; idempotencyKey: string }>();

  prepare(scope: string, payload: Record<string, unknown>): { body: string; idempotencyKey: string } {
    const serialized = JSON.stringify(payload);
    let attempt = this.#attempts.get(scope);
    if (!attempt || attempt.payload !== serialized) {
      attempt = { payload: serialized, idempotencyKey: crypto.randomUUID() };
      this.#attempts.set(scope, attempt);
    }
    return { body: JSON.stringify({ ...payload, idempotencyKey: attempt.idempotencyKey }), idempotencyKey: attempt.idempotencyKey };
  }

  complete(scope: string, key: string): void {
    if (this.#attempts.get(scope)?.idempotencyKey === key) this.#attempts.delete(scope);
  }
}
