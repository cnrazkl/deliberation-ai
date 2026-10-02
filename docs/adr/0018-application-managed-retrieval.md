# ADR-0018: Application-managed public web retrieval

Status: accepted and implemented

## Decision

Add a separate, owner-initiated retrieval boundary for public HTML, plain-text and selectable-text PDF documents, plus an optional isolated browser mode for JavaScript-rendered text. A retrieval is always attached to one persisted claim. It produces an encrypted immutable research capture with the requested/final URL, extracted plain text, content type, byte length, redirect count, capture time and SHA-256 digest. It starts `unreviewed` and does not alter claim evidence, synthesis coverage, council output or decision-assessment state.

The owner may reject the capture or copy an exact substring of its frozen text into a new evidence-source record. Promotion starts the existing content and freshness reviews at `unreviewed`; it is not verification. The original capture remains inspectable after promotion.

## Network boundary

Only unauthenticated `http` and `https` URLs on ports 80 and 443 are accepted. The retriever resolves every A/AAAA result, rejects the target when any address is non-public, and pins the connection to a validated address. It disables automatic redirects and repeats full URL, DNS and address validation for each of at most three redirects. Loopback, private, link-local, carrier-grade NAT, documentation, benchmark, multicast, reserved, IPv4-mapped private IPv6 and metadata-reachable address ranges are blocked.

Direct requests use a ten-second deadline, no retries, a fixed user agent, identity encoding, a 16 KiB response-header cap and a 1 MiB body cap. HTML and plain text discard executable markup. PDF.js extracts selectable text from the bounded byte snapshot with image/WASM rendering disabled, at most 100 pages and a separate ten-second parse deadline.

Browser mode creates a fresh non-persistent Playwright context with service workers, permissions and downloads disabled. Each HTTP(S) document, script, stylesheet or data request is fulfilled only after passing through the same validated, pinned retriever. Non-GET, image, media, font, manifest, WebSocket and event-stream requests are blocked. Rendering stops at 20 requests, 5 MiB total or 15 seconds. Only normalized body text is persisted, up to 64,000 characters; the digest covers that rendered-text snapshot. Browser content is never inserted into the product UI as executable HTML or treated as instructions.

These controls follow the [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) to constrain schemes, resolve and classify all addresses, avoid automatic redirects, and prevent DNS rebinding through connection-time address control. Node's documented custom [`lookup` request option](https://nodejs.org/download/release/latest-v24.x/docs/api/http.html) supplies the pinned address.

## Consequences

Public websites may still refuse automated requests or provide image-only/encrypted PDFs that have no safely extractable text. Browser mode improves client-rendered text capture but does not reproduce authenticated sessions, media, fonts or unrestricted browser behavior. The capture records what this application received at one time; its digest proves local snapshot consistency, not authorship, credibility or current truth. Deployment outside the current single-owner computer still requires network-level egress controls in addition to these application checks.
