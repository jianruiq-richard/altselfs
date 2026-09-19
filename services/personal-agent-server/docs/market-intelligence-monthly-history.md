# Market intelligence monthly history

The market-intelligence database separates stable product identity, provider observations, monthly facts, and the latest list-view summary.

## Storage rules

- `market_intelligence.products` stores stable product metadata plus a denormalized latest summary for the existing production list API.
- `market_intelligence.product_monthly_metrics` stores one canonical Similarweb-derived audience record per product and calendar month.
- `market_intelligence.product_monthly_revenue_estimates` stores versioned revenue estimates per product and month. One row per product/month is marked `is_current`; older model versions remain queryable.
- `market_intelligence.product_payment_metrics` stores one canonical Semrush payment-destination observation per product and calendar month. A later unavailable result never replaces a previously measured value.
- `market_intelligence.product_pricing_snapshots` stores one canonical official-site pricing snapshot per product and calendar month.
- `market_intelligence.product_app_metrics` stores every Appark rolling-30-day snapshot by observation time, including its exact period boundaries and a reference month.
- `market_intelligence.raw_observations` is append-only provider evidence. Reprocessing derived tables must not remove it.

## Import rules

The generated payload uses schema version 3 and `importMode: "upsert-history"`.

The importer upserts only the rows present in the payload. It does not delete historical audience, app, payment, or revenue rows. Product removal is disabled unless a deliberately generated payload sets `metadata.replaceProductCatalog` to `true`.

The existing production API remains backward compatible: it reads the denormalized latest summary from `products`, the latest audience month, and the latest Appark snapshot. Historical APIs can be added without changing the list response.

## Monthly update contract

For a new month:

1. append all provider responses to `raw_observations`;
2. upsert that month's Similarweb, Semrush, and pricing canonical rows;
3. append the Appark snapshot with its rolling period boundaries;
4. calculate and upsert the month's versioned revenue estimate;
5. update `products` only with the latest summary.

Re-running a month updates that month's canonical facts while retaining raw evidence. Changing the estimator must also change `model_version`, which preserves the older estimate and makes the strongest current version explicit.

Build and import an isolated month with:

```sh
node services/personal-agent-server/scripts/build-market-intelligence-import.mjs \
  <enrichment-directory> <payload.json> --month=YYYY-MM

node services/personal-agent-server/scripts/import-market-intelligence-raw-observations.mjs \
  <enrichment-directory> --month=YYYY-MM

node services/personal-agent-server/scripts/import-market-intelligence.mjs <payload.json>
```

The month-scoped builder reads `semrush-YYYY-MM.raw.jsonl`,
`similarweb-snapshots/YYYY-MM/similarweb.raw.jsonl`, and the matching Appark
snapshot directory. Its canonical audience, payment, app reference, and revenue
rows are restricted to that month. Older monthly rows are not included in the
payload and therefore are not overwritten. The denormalized `products` summary
is refreshed from the requested target month for the production list API.
