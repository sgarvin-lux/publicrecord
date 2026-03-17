# CMS Penalty Data Ingestion — Design Spec

**Ticket:** PUB-4
**Date:** 2026-03-17
**Status:** Approved

## Overview

Ingest nursing home penalty/enforcement data from CMS into the `penalties` table. The script fetches all records from the CMS Provider Data JSON API, resolves provider references, and upserts into Supabase. Runs daily at 3am UTC via GitHub Actions.

## CMS Data Source

- **Dataset:** Nursing Home Penalties (`g6vv-u9sr`)
- **API endpoint:** `https://data.cms.gov/provider-data/api/1/datastore/query/g6vv-u9sr/0`
- **Pagination:** `limit` (max 1000) + `offset` query params; response includes `results` array and `count` total
- **Update frequency:** Monthly (next: March 25, 2026)
- **Current size:** ~17,500 records (covers last 3 years)

### CMS Field Mapping

| CMS API Field                  | Our Column     | Transform                                               |
| ------------------------------ | -------------- | ------------------------------------------------------- |
| `cms_certification_number_ccn` | `provider_id`  | Lookup via `providers.cms_id`                           |
| `penalty_date`                 | `penalty_date` | Parse from `MM/DD/YYYY` to `YYYY-MM-DD`                 |
| `penalty_type`                 | `penalty_type` | As-is (`"Fine"`, `"Payment Denial"`); skip if null      |
| `fine_amount`                  | `amount`       | Parse to number; default `0` for Payment Denial records |
| (composed)                     | `description`  | See description composition rules below                 |

### Data Handling Notes

- **Date format:** CMS returns dates as `MM/DD/YYYY`; transform to `YYYY-MM-DD` for PostgreSQL
- **Amount for Payment Denials:** CMS `fine_amount` is empty/null for Payment Denial records. Default to `0` so the unique constraint works (PostgreSQL `NULL != NULL` would prevent upsert matching).
- **Required fields:** Skip records where `penalty_type` or `penalty_date` is null/empty (log warning)

### Description Composition

- **Fine:** `"Civil money penalty: $12,500"`
- **Payment Denial:** `"Payment denial: 30 days starting 2025-01-15"`
  - Uses `payment_denial_length_in_days` and `payment_denial_start_date` fields
  - If denial fields are missing, falls back to `"Payment denial"`

## Architecture

### New Files

```
scripts/ingest-penalties.ts           — main ingestion script
scripts/lib/cms-api.ts                — reusable CMS API client
scripts/lib/supabase-admin.ts         — service-role Supabase client for scripts
.github/workflows/ingest-penalties.yml — daily cron + manual dispatch
```

### Database Migration

Add a unique constraint to support upserts:

```sql
ALTER TABLE penalties
  ADD CONSTRAINT uq_penalties_natural_key
  UNIQUE (provider_id, penalty_date, penalty_type, amount);
```

### Shared CMS API Client (`scripts/lib/cms-api.ts`)

```ts
fetchAllPages(datasetId: string, pageSize?: number): Promise<Record<string, string>[]>
```

- Pages through the CMS API until `offset >= count`
- Default page size: 1000
- Retries each page up to 3 times with exponential backoff
- Reusable for PUB-2 (provider data) and PUB-3 (deficiency data)

### Shared Supabase Admin Client (`scripts/lib/supabase-admin.ts`)

- Uses `@supabase/supabase-js` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars
- Shared across all ingestion scripts

## Ingestion Flow

1. **Fetch** — `fetchAllPages('g6vv-u9sr')` returns all ~17.5k raw records
2. **Resolve providers** — extract unique `cms_certification_number_ccn` values, query `SELECT id, cms_id FROM providers WHERE cms_id IN (...)`, build `Map<string, string>` (cms_id → provider UUID)
3. **Transform** — map each raw record to `penalties` row schema; skip records with unresolvable CMS IDs (log warnings)
4. **Upsert** — batch in chunks of 500, using `supabase.from('penalties').upsert(batch, { onConflict: 'provider_id,penalty_date,penalty_type,amount' })`; on conflict updates `description`
5. **Report** — log: total fetched, providers matched/unmatched, records upserted, errors

## GitHub Actions Workflow

```yaml
name: Ingest CMS Penalties
on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch: {}
jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npx tsx scripts/ingest-penalties.ts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

## Error Handling

| Scenario              | Behavior                                                 |
| --------------------- | -------------------------------------------------------- |
| CMS API page failure  | Retry up to 3 times with exponential backoff, then throw |
| Unknown CMS ID        | Log warning, skip record, continue                       |
| Upsert batch failure  | Log error with batch details, continue remaining batches |
| Zero records upserted | Exit code 1 (signals total failure to GitHub Actions)    |

## Testing

- **Unit tests:** transform logic (description composition, amount parsing, date handling, edge cases like missing denial fields)
- **Integration test:** mock CMS API responses, verify full pipeline produces correct upsert payloads

## Acceptance Criteria (from ticket)

- [x] Upserts into `penalties` table keyed on `(provider_id, penalty_date, penalty_type, amount)`
- [ ] Handles ~40,000+ penalty records (currently ~17.5k, designed for growth)
- [x] Scheduled daily at 3am UTC
