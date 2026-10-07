// Explicit opt-in only. Uses the running local application's reviewed check API;
// never reads credentials, owner prompts or source files and never auto-retries.
import { randomUUID } from "node:crypto";
const args = process.argv.slice(2);
if (args.shift() !== "--live" || args.length < 1 || args.length > 8
  || args.some((id) => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id))
  || new Set(args.map((id) => id.toLowerCase())).size !== args.length) throw new Error("Explicit --live and 1–8 distinct saved connection IDs required.");
for (const connectionId of args.map((id) => id.toLowerCase())) {
  const endpoint = `http://127.0.0.1:3000/api/provider-connections/${connectionId}/generation-check`;
  const requestId = randomUUID();
  try {
    const reviewResponse = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
    if (!reviewResponse.ok) { console.log(JSON.stringify({ connectionId, status: "review_unavailable" })); continue; }
    const review = await reviewResponse.json();
    const response = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ requestId, model: review.model, fingerprint: review.fingerprint, acknowledge: true }) });
    if (!response.ok) { console.log(JSON.stringify({ connectionId, requestId, status: "check_not_confirmed", httpStatus: response.status })); continue; }
    const result = await response.json();
    console.log(JSON.stringify({ connectionId, requestId, model: result.model, revision: result.revision, status: result.status,
      failure: result.failure, returnedModel: result.returnedModel, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      httpStatus: result.httpStatus, outputCapExceeded: result.outputCapExceeded,
      elapsedMs: result.elapsedMs, invoiceCost: "unknown" }));
  } catch {
    console.log(JSON.stringify({ connectionId, requestId, status: "check_not_confirmed", invoiceCost: "unknown" }));
  }
}
