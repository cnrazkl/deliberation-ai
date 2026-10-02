# ADR-0019: Local MCP result boundary

Status: accepted and implemented on 22 September 2026.

## Decision

MCP connections use Streamable HTTP only on `127.0.0.1`, `localhost`, or `::1`. The owner saves the connection, refreshes its current tool list and explicitly invokes one listed tool with a JSON object. The client re-lists immediately before invocation, applies a 15-second deadline, accepts only bounded text output and closes the session after each operation.

Successful results and arguments are encrypted as immutable local records. A run may select at most three results or ask for deterministic Turkish-aware lexical top-3 retrieval. The chosen result text and digest are frozen with the run and labeled as untrusted data. It reaches round 0 only; cross-review receives validated model text and no tool context.

## Consequences

Model output cannot authorize a tool call, choose arguments, reach a non-loopback MCP server, or mutate the stored tool result. The product does not claim semantic vector retrieval: automatic selection is a small deterministic word-overlap index that remains inspectable and replaceable later.
