# Utilization PUF Ingestion Design

**Goal:** Ingest Medicare Post-Acute Care Utilization & Payment PUF data for SNF, HHA, and Hospice providers into `payment_history`, filling gaps where HCRIS data is absent.

**Date:** 2026-03-17

---

## Overview

The Medicare Post-Acute Care (PAC) Utilization Public Use Files are annual CSV files published by CMS at `data.cms.gov`. Each file covers a single calendar/fiscal year and contains provider-level, state-level, and national-level summary rows. We ingest only provider-level rows.

Three datasets:
- **SNF:** `RY_2025_PAC_PUF_SNF_2023_main_final_unformatted.csv` (~14,161 provider rows, FY 2023)
- **HHA:** `RY_2025_PAC_PUF_HH_2023_main_final_unformatted.csv` (~8,466 provider rows, CY 2023)
- **Hospice:** `RY_2025_PAC_PUF_HOS_2023_main_final_unformatted.csv` (~5,771 provider rows, FY 2023)

All three files share an identical column structure for the fields we need.

---

## Architecture

Two new files:

- **`scripts/lib/puf.ts`** — types, CSV streaming, shared transform, upsert helpers
- **`scripts/ingest-puf.ts`** — orchestrator: 3 hardcoded URLs → fetch → transform → upsert

One test file:

- **`scripts/lib/__tests__/puf.test.ts`** — unit tests for pure functions in `puf.ts`

No per-type transform files. All three PUFs share the same field mapping, so a single `transformPufRows()` handles all three. The orchestrator calls it three times with the three URLs.

`puf.ts` reuses `resolveProviders()` from `hcris.ts` for CCN → UUID lookup. It defines its own types and upsert functions because the conflict behavior differs from HCRIS.

---

## Data Source

Download URLs are hardcoded constants in `ingest-puf.ts`. The URL path includes a CMS-generated hash that changes annually; updating the constants is the annual maintenance step.

```typescript
const PUF_URLS = {
  snf: "https://data.cms.gov/sites/default/files/2025-08/b646c0b9-5fe0-475c-8820-007680020fdc/RY_2025_RY_25_PAC_PUF_SNF_2023_main_final_unformatted.csv",
  hha: "https://data.cms.gov/sites/default/files/2025-08/1d04af0f-9173-47b0-b5f8-26df7722247c/RY_2025_RY_25_PAC_PUF_HH_2023_main_final_unformatted.csv",
  hospice: "https://data.cms.gov/sites/default/files/2025-08/7c92ef92-85ff-4f2a-a1a6-b1f4f25210e4/RY_2025_RY_25_PAC_PUF_HOS_2023_main_final_unformatted.csv",
};
```

---

## Transform

### Row filtering

Only rows where `SMRY_CTGRY === 'PROVIDER'` are processed. National and state summary rows are skipped.

### Field mapping

All three PUF file types use the same column names for the fields we need:

| CSV column | `payment_history` column | Notes |
|---|---|---|
| `PRVDR_ID` | CCN → `provider_id` | Resolved via `resolveProviders()` |
| `YEAR` | `fiscal_year` | Parsed as integer |
| `TOT_MDCR_PYMT_AMT` | `medicare_payments` | Via `parseAmount()` |
| `TOT_CHRG_AMT` | `total_charges` | Via `parseAmount()` |
| `TOT_SRVC_DAYS` | `total_days` | Via `parseAmount()` |
| `BENE_DSTNCT_CNT` | `total_patients` | Via `parseAmount()` |
| _(hardcoded)_ | `data_source: "utilization_puf"` | |

### `parseAmount()` helper

Converts CSV string values to `number | null`:
- `"*"` (CMS-suppressed small counts) → `null`
- Empty string → `null`
- Non-numeric → `null`
- Valid number → `parseFloat(value)`

### CSV streaming

`fetchAndParsePufCsv(url)` in `puf.ts`:
1. `fetch(url)` the CSV
2. Stream response body through Node `readline` line by line
3. First line → parse as header row
4. Subsequent lines → split on comma, zip with header names into `Record<string, string>`
5. Return all rows (caller filters by `SMRY_CTGRY`)

This matches the `parseHcrisFile()` pattern in `hcris.ts`.

---

## HCRIS Preference Strategy

PUF is purely additive — it fills gaps, never displaces HCRIS data.

### `payment_history` table

Upsert uses `ON CONFLICT (provider_id, fiscal_year) DO NOTHING`. If HCRIS already wrote a row for a provider+year, the PUF row is silently skipped. No schema change required.

### `providers` table

After inserting payment history rows, update `annual_medicare_payments`, `payment_data_year`, and `payment_data_source` only for providers where `payment_data_source IS NULL`. HCRIS-populated providers are untouched.

```sql
-- Conceptual: only update providers with no existing payment source
UPDATE providers
SET annual_medicare_payments = $1,
    payment_data_year = $2,
    payment_data_source = 'utilization_puf'
WHERE id = $3
  AND payment_data_source IS NULL
```

The ingest script resolves which providers qualify before issuing updates (read `payment_data_source` in the provider resolution step, or use conditional update in the DB call).

---

## Ingest Script (`ingest-puf.ts`)

Sequential flow:

1. Fetch and parse SNF CSV → `transformPufRows()` → resolve CCNs → `upsertPufPaymentHistory()`
2. Fetch and parse HHA CSV → same
3. Fetch and parse Hospice CSV → same
4. Build provider updates from all inserted rows → `updateProvidersFromPuf()` (filtered to `payment_data_source IS NULL`)
5. Print summary: rows fetched / matched / inserted / skipped (HCRIS conflicts) / providers updated

Trigger: `npx tsx scripts/ingest-puf.ts` — annual manual run.

---

## Testing

All tests in `scripts/lib/__tests__/puf.test.ts`, covering pure functions only (no I/O):

**`parseAmount()`**
- `"*"` → `null`
- `""` → `null`
- `"abc"` → `null`
- `"25968510365"` → `25968510365`
- `"797586"` → `797586`

**`transformPufRows()`**
- Skips rows where `SMRY_CTGRY !== 'PROVIDER'`
- Skips rows with unknown CCN (not in lookup map)
- Maps all fields correctly for a complete row
- Returns `null` for suppressed (`*`) amounts
- Returns `null` for empty amounts

**`buildPufProviderUpdates()`**
- Returns update only when `payment_data_source` is null for that provider
- Skips provider when `payment_data_source` is already set (e.g., `"hcris"`)
- Picks highest fiscal year when multiple PUF rows exist for the same provider
- Skips provider when `medicare_payments` is null

---

## No Schema Changes

`payment_history` already has `data_source VARCHAR` (nullable). The `ON CONFLICT DO NOTHING` strategy works with the existing `(provider_id, fiscal_year)` unique index. No migration required.
