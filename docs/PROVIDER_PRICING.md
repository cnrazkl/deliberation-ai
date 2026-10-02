# DA-082 — versioned token price observations and estimates

An operator can record a price observation for one owned connection revision and exact model id. Each submitted council attempt binds the latest observation available at submission; recording a replacement never reprices an earlier attempt. The run usage view displays an auditable token estimate and a **partial subtotal of calculable attempts**, with unavailable attempts counted separately. This is neither a provider invoice nor a settled-cost ledger or monetary budget.

## Recording an observation

Use an absolute local JSON path without spaces with the existing Windows command wrapper:

```powershell
pnpm pricing:record C:/Users/caner/Projects/DeliberationAI/.local/price-observation.json
pnpm pricing:list
```

`pricing:list` returns the latest 100 owned observations. Recording does not fetch the reference URL, contact a model, validate contractual prices or initiate a run. There is no price-entry browser screen in this increment. The following is a **synthetic format example**, not a current provider rate card; replace every placeholder and confirm the applicable standard text-token rates before recording:

```json
{
  "version": "token-price-v1",
  "connectionId": "00000000-0000-4000-8000-000000000001",
  "model": "exact-model-id",
  "sourceUrl": "https://example.com/pricing",
  "observedAt": "2026-10-01T00:00:00.000Z",
  "validUntil": "2026-10-02T00:00:00.000Z",
  "currency": "USD",
  "inputBasis": "inclusive",
  "outputBasis": "inclusive",
  "maxInputTokens": 200000,
  "inputUsdPerMillion": "2",
  "outputUsdPerMillion": "8",
  "cachedInputUsdPerMillion": "0.5"
}
```

The observation must be nonfuture, currently valid and valid for at most 31 days from observation. Rates are decimal strings with at most six fractional digits, from zero through 999999.999999 USD per million tokens. The reference must be HTTPS without credentials, query parameters or a fragment. Source URL, observation/expiry dates, counting bases, input band and rates are encrypted together; SHA-256 binds this payload and connection revision. The URL and timestamp record the operator's observation, not an archived source-page digest or proof of billing terms.

Identical normalized observations for the same connection revision return the existing id, including concurrent writes. Changed rates/dates create a new immutable application record. Connection edits increment its revision and require a new observation. Latest expired observations do not fall back to older rates. Connection deletion leaves historical observations intact. There is no application update/delete operation for prices; a database administrator still has database write authority.

## Submission and calculation

The worker supplies the loaded connection id/revision to the atomic submission claim. Persistence verifies the frozen run member, provider, exact model and current owned connection revision before binding an observation. Calls without a suitable observation proceed with unknown price. Round-0 image delivery is outside the text profile and remains unpriced. Successful receipt replay creates no new submission or estimate. A manually authorized new attempt binds the observation current at its own submission; selected-member children price only their new calls, never copied answers.

The first succeeded, failed or unknown outcome stores `token-cost-v1` beside the receipt, encrypted under `provider-operation:<id>:cost-estimate`. It contains price id/fingerprint, usage fingerprint, component token counts/rates, integer pico-USD amounts and a 12-decimal USD display. Arithmetic uses integers, including genuine zero rates. It requires an exact returned model match. A failed structured-output parse can still have a calculable token estimate when the adapter retained complete usage.

- Inclusive input subtracts cached-read tokens before applying the ordinary input rate; cache tokens receive their own rate once.
- Uncached input applies the ordinary rate to the reported uncached count and adds separately reported cached reads. Cache-write count must be explicitly known.
- Inclusive output already includes reasoning; it is never added twice. Candidate-only output requires a separately reported reasoning count and adds it once.
- Missing input/output/cache/reasoning counts, positive cache writes without TTL detail, incompatible native conventions, unmatched returned model, out-of-band input or absent cache rates produce an unavailable amount rather than zero.
- Compatible endpoints may report `provider_defined` conventions; the operator-declared basis controls the estimate and is not a provider verification.

The first estimate is not rewritten by later counter changes. Reads compare its usage fingerprint with current counters/metadata; drift projects the amount as unavailable while retaining the original encrypted calculation. A damaged price observation before submission rejects that local claim. If integrity cannot be confirmed after submission, the result/usage is retained with unknown cost. Unknown outcomes remain unknown through discard; historical receipts are not backfilled with newly recorded prices.

`GET /api/runs/:id/usage` remains owned, uncached and read-only. A repeatable-read transaction aggregates all attempts in bounded pages; only the latest 100 attempt details are displayed. It exposes no credentials, prompts or model output. The browser shows snapshot/usage fingerprints and component arithmetic under “Fiyat ve hesap kaydı”. A null subtotal means no estimate is available; a displayed subtotal covers only the counted calculable attempts.

## Deliberate limits and next gate

DA-083 now adds a separate [owner-reviewed billing-evidence foundation](PROVIDER_BILLING.md). It does not turn these token estimates into settled invoices; authentic provider/account/payment acceptance and monetary reservations remain open.

Only standard text-token estimates in USD are supported. Tool/search charges, cache-write TTL pricing, storage, image/audio/video rates, different context tiers beyond the declared band, batch/priority/region discounts, taxes and invoice reconciliation are outside the estimate. This does not estimate a total invoice, enforce input/tool/money budgets or prove remote cap enforcement. No provider prices are seeded automatically. The next usage increment requires full billing dimensions and provider invoice/receipt reconciliation before a **settled** ledger can be claimed; monetary reservations must conservatively handle unknown outcomes and retries.

Official references inspected on 1 October 2026 explain why counts cannot be assigned one universal rate: [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) distinguishes cache-write durations, tools and service options; [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) distinguishes input modalities/context bands and output including thinking. No numerical live prices from those pages are hardcoded here.

Migration `0034_wealthy_slapstick.sql` adds the encrypted observation table and nullable attempt price/submission/estimate fields. Price observations outlive run retention; deleting an eligible run cascades its attempts/estimates. Backup inventory covers both new ciphertext columns and rejects unknown encrypted schema fields. See the DA-082 verification entry in [CURRENT_STATE.md](CURRENT_STATE.md).

## Local acceptance — 1 October 2026

211 offline unit tests, 52 isolated PostgreSQL integration tests, all 12 browser flows, type checking, lint and production build passed. Tests exercise exact nonoverlapping cache/thinking arithmetic, zero/large values, concurrent idempotent observations, owned revision/model binding, expiry, unknown/discard behavior, no retroactive pricing, usage drift, price corruption after submission without losing the result, and totals beyond the 100-attempt detail window. The browser uses synthetic local HTTP receipts and verifies that a later price changes the child estimate while preserving the parent's calculation. These checks do not establish provider billing accuracy.

Migration `0034` is applied to the local database and through fresh isolated migration runs. Recording was smoke-tested through the operator command with a generated owned connection and synthetic JSON. Backup `deliberation-20261001T081350Z-e7de543d8cd3.manifest.json` restored into a temporary database, checked 290 runs / 4,973 encrypted rows / 7,623 decrypted values, and included populated new price and estimate ciphertext columns. It contains generated offline fixture records; the fixture connection, price, cancelled run and attempt were removed from the live database afterward. The browser suite was active during the backup snapshot, so these counts describe that snapshot, not a final live-run inventory. No queue job or model request was created by the backup fixture. No real rate card was seeded, paid model called, retention applied to owner history or JEV activated. Replacement recovery/cutover and the broad original-plan gate remain open.
