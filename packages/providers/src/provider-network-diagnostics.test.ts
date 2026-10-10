import { expect, test } from "vitest";
import { providerNetworkError, withProviderNetworkDeadline } from "./provider-utils";
test("allowlists transport diagnostics without leaking error messages or credentials", () => {
  for (const [cause, expected] of [["EAI_AGAIN", "provider_dns_failure"], ["ENOTFOUND", "provider_dns_failure"], ["ECONNREFUSED", "provider_connection_refused"], ["ECONNRESET", "provider_connection_reset"], ["UND_ERR_CONNECT_TIMEOUT", "provider_timeout"], ["ERR_TLS_CERT_ALTNAME_INVALID", "provider_tls_failure"], ["SECRET_ERROR", "remote_outcome_unknown"]]) {
    const error = providerNetworkError("Fixture", new TypeError("SECRET with credential", { cause: { code: cause } }));
    expect(error.code).toBe(expected); expect(error.outcome).toBe("unknown"); expect(error.retryable).toBe(false);
    expect(error.message).not.toContain("SECRET");
  }
  expect(providerNetworkError("Fixture", new SyntaxError("SECRET body")).code).toBe("provider_response_unreadable");
});
test("a bounded deadline remains uncertain and never retries an abort-ignoring operation", async () => {
  let calls = 0;
  try { await withProviderNetworkDeadline(async () => { calls++; return new Promise<never>(() => {}); }, 5); }
  catch (error) { expect(providerNetworkError("Fixture", error).code).toBe("provider_timeout"); }
  expect(calls).toBe(1);
});
