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

`puf.ts` reuses `resolveProviders()` from `hcris.ts` for CCN → UUID lookup. Before calling `resolveProviders()`, the ingest script deduplicates CCNs across all three datasets to avoid redundant DB queries (the function already batches in chunks of 1000, so deduplication is a courtesy optimization, not a correctness concern).

`puf.ts` defines its own types and upsert functions — **do not model them on `hcris.ts` equivalents** — because the conflict behavior and provider update conditions differ.

---

## Types

Defined in `puf.ts`:

```typescript
export interface PufPaymentHistoryRow {
  provider_id: string;
  fiscal_year: number;
  medicare_payments: number | null;
  total_charges: number | null;
  total_days: number | null;
  total_patients: number | null;
  data_source: "utilization_puf";
}

export interface PufProviderUpdate {
  provider_id: string;
  annual_medicare_payments: number;
  payment_data_year: number;
  payment_data_source: "utilization_puf";
  charge_to_payment_ratio: number | null;
}
```

`PufPaymentHistoryRow` mirrors `PaymentHistoryRow` from `hcris.ts` but with `data_source: "utilization_puf"`. `PufProviderUpdate` mirrors `ProviderUpdate` from `hcris.ts` (including `charge_to_payment_ratio`) with `payment_data_source: "utilization_puf"`.

---

## Data Source

Download URLs are hardcoded constants in `ingest-puf.ts`. The URL path includes a CMS-generated hash that changes annually; updating the constants is the annual maintenance step.

```typescript
const PUF_URLS = {
  snf: "https://data.cms.gov/sites/default/files/2025-08/b646c0b9-5fe0-475c-8820-007680020fdc/RY_2025_RY_25_PAC_PUF_SNF_2023_main_final_unformatted.csv",
  hha: "https://data.cms.gov/sites/default/files/2025-08/1d04af0f-9173-47b0-b5f8-26df7722247c/RY_2025_RY_25_PAC_PUF_HH_2023_main_final_unformatted.csv",
  hospice:
    "https://data.cms.gov/sites/default/files/2025-08/7c92ef92-85ff-4f2a-a1a6-b1f4f25210e4/RY_2025_RY_25_PAC_PUF_HOS_2023_main_final_unformatted.csv",
};
```

---

## Transform

### Row filtering

Only rows where `SMRY_CTGRY === 'PROVIDER'` are processed. National and state summary rows are skipped.

### Field mapping

All three PUF file types use the same column names for the fields we need:

| CSV column          | `payment_history` column         | Notes                             |
| ------------------- | -------------------------------- | --------------------------------- |
| `PRVDR_ID`          | CCN → `provider_id`              | Resolved via `resolveProviders()` |
| `YEAR`              | `fiscal_year`                    | Parsed as integer                 |
| `TOT_MDCR_PYMT_AMT` | `medicare_payments`              | Via `parseAmount()`               |
| `TOT_CHRG_AMT`      | `total_charges`                  | Via `parseAmount()`               |
| `TOT_SRVC_DAYS`     | `total_days`                     | Via `parseAmount()`               |
| `BENE_DSTNCT_CNT`   | `total_patients`                 | Via `parseAmount()`               |
| _(hardcoded)_       | `data_source: "utilization_puf"` |                                   |

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

`upsertPufPaymentHistory()` in `puf.ts` uses the Supabase client with `ignoreDuplicates: true`:

```typescript
await supabaseAdmin.from("payment_history").upsert(batch, {
  onConflict: "provider_id,fiscal_year",
  ignoreDuplicates: true, // ← DO NOTHING, not DO UPDATE
  count: "exact",
});
```

**Do not model this on `upsertPaymentHistory()` from `hcris.ts`** — that function uses the default behavior (`DO UPDATE SET ...`), which would overwrite existing HCRIS rows. `ignoreDuplicates: true` maps to `ON CONFLICT DO NOTHING`.

### `providers` table

`buildPufProviderUpdates()` accepts the full set of attempted PUF rows plus a map of each provider's current `payment_data_source`. It returns updates only for providers where `payment_data_source IS NULL`. When multiple PUF rows exist for the same provider (across datasets), the highest `fiscal_year` wins.

`charge_to_payment_ratio` is computed from `total_charges / medicare_payments` using the same `computeChargeToPaymentRatio()` helper from `hcris.ts`. Returns `null` if either value is null or if `medicare_payments` is 0.

The Supabase update call applies a DB-side guard as the authoritative filter:

```typescript
await supabaseAdmin
  .from("providers")
  .update({
    annual_medicare_payments,
    payment_data_year,
    payment_data_source: "utilization_puf",
    charge_to_payment_ratio,
  })
  .eq("id", provider_id)
  .is("payment_data_source", null); // ← primary guard; DO NOT remove
```

The `payment_data_source IS NULL` condition on the DB call is the primary correctness guard. The pre-filtering in `buildPufProviderUpdates()` is a secondary optimization to avoid issuing no-op updates.

---

## Ingest Script (`ingest-puf.ts`)

Sequential flow:

1. Fetch and parse all three CSVs, collect provider-level rows
2. Deduplicate CCNs across all three datasets → `resolveProviders()` → lookup map
3. `transformPufRows()` for each dataset using the shared lookup
4. `upsertPufPaymentHistory()` for each dataset (with `ignoreDuplicates: true`)
5. Build provider updates from all attempted PUF rows → `buildPufProviderUpdates()`
6. `updateProvidersFromPuf()` — issues conditional updates with `.is("payment_data_source", null)` guard
7. Print summary: rows fetched / matched / inserted / providers updated

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
- Computes `charge_to_payment_ratio` when both `total_charges` and `medicare_payments` are non-null
- Sets `charge_to_payment_ratio` to `null` when `total_charges` is null

---

## No Schema Changes

`payment_history` already has `data_source VARCHAR` (nullable). The `ignoreDuplicates: true` upsert strategy works with the existing `(provider_id, fiscal_year)` unique index. No migration required.
