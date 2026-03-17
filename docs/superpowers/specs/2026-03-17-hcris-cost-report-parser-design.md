# HCRIS Cost Report Parser — Design Spec

**Issue:** PUB-7
**Milestone:** M3: Payment Data & Scoring
**Date:** 2026-03-17
**Status:** Approved

---

## Overview

Build a TypeScript parser for CMS HCRIS (Healthcare Cost Report Information System) data to extract per-provider annual Medicare revenue. This populates the `payment_history` table and updates `providers.annual_medicare_payments` — the primary input for the Estimated Taxpayer Exposure (ETE) calculation.

The parser runs quarterly as a manual operator-triggered script. Operators download zip files from CMS and pass local paths as CLI arguments.

---

## File Structure

```
scripts/
  parse-hcris-snf.ts              # SNF entrypoint (CLI arg: path to zip)
  parse-hcris-hha.ts              # HHA entrypoint
  parse-hcris-hospice.ts          # Hospice entrypoint
  lib/
    hcris.ts                      # Shared: zip extraction, RPT/NMRC loading, join, report selection
    transform-hcris-snf.ts        # Worksheet coordinates + row transform for SNF
    transform-hcris-hha.ts        # Worksheet coordinates + row transform for HHA
    transform-hcris-hospice.ts    # Worksheet coordinates + row transform for Hospice
    __tests__/
      hcris.test.ts               # Unit tests for shared join/selection logic
      transform-hcris-snf.test.ts
      transform-hcris-hha.test.ts
      transform-hcris-hospice.test.ts

docs/
  hcris-quarterly-runbook.md      # Step-by-step operator instructions
```

Test files for `lib/` modules live in `scripts/lib/__tests__/`, following the existing convention (e.g. `scripts/lib/__tests__/transform-penalties.test.ts`).

The three entrypoint scripts are intentionally thin — they wire together `hcris.ts` (loading/joining) and `transform-hcris-*.ts` (field extraction), then call shared ingestion logic. All operator-facing documentation lives in the runbook.

Each entrypoint includes the standard `isDirectRun` guard so it can be imported by tests without auto-executing:

```typescript
const isDirectRun = import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) { main().catch(...) }
```

---

## Data Source

Raw HCRIS bulk downloads from CMS:

- `cms.gov/data-research/statistics-trends-and-reports/cost-reports/cost-reports-fiscal-year`
- Separate zip files for SNF (Form CMS-2540-10), HHA (Form CMS-1728-20), and Hospice (Form CMS-1984-14)
- Each zip contains three **pipe-delimited** (`|`) files joined by `RPT_REC_NUM`:
  - **RPT** — report metadata (provider CCN, fiscal year dates, processing date, status)
  - **NMRC** — numeric financial values keyed by `(RPT_REC_NUM, WKSHT_CD, LINE_NUM, CLMN_NUM)`
  - **ALPHNMRC** — alpha-numeric values (not used)

Note: cost reports lag ~18 months. This is expected and acceptable.

---

## Data Flow

1. **CLI invocation** — operator passes local zip path:

   ```
   npx tsx scripts/parse-hcris-snf.ts ~/downloads/snf_fy2023.zip
   ```

2. **Extract zip** → temp directory created with `fs.mkdtempSync(path.join(os.tmpdir(), 'hcris-'))`. Locate RPT and NMRC files by filename suffix (`_RPT_` / `_NMRC_`). Temp directory is cleaned up in a `finally` block regardless of success or failure.

3. **Load RPT file** → parse pipe-delimited file into report metadata rows. Relevant columns:
   - `RPT_REC_NUM` — join key
   - `PRVDR_NUM` — provider CCN
   - `FY_BGN_DT`, `FY_END_DT` — fiscal year dates (format: `MM/DD/YYYY`)
   - `PROC_DT` — processing date (used for tie-breaking)
   - `RPT_STUS_CD` — status: `1` = As Submitted, `2` = Settled, `4` = Amended/Settled

4. **Select best report per provider-year** — `fiscal_year` is derived from the **calendar year of `FY_END_DT`** (e.g. `12/31/2023` → `2023`). For each `(PRVDR_NUM, fiscal_year)` pair:
   - Prefer settled/amended-settled (`RPT_STUS_CD` 2 or 4) over as-submitted (1)
   - Among ties on status, take the most recent `PROC_DT`
   - If status and `PROC_DT` are both equal (degenerate case), pick the last-seen row and log a warning with the CCN
   - Produces a map of `RPT_REC_NUM → selected_report`

5. **Load NMRC file** → parse pipe-delimited file; filter to rows whose `RPT_REC_NUM` is in the selected set; group by `RPT_REC_NUM`.

6. **Extract fields** — for each selected report, look up specific `(WKSHT_CD, LINE_NUM, CLMN_NUM)` coordinates defined in `transform-hcris-*.ts`; build a `PaymentRecord`. Missing coordinates produce `null` values, not errors.

7. **Match to providers** — batch-lookup `provider_id` in Supabase by `cms_id = PRVDR_NUM` (1000 CCNs per batch, matching the existing `ingest-penalties.ts` pattern for provider lookups).

8. **Upsert to `payment_history`** — build `PaymentHistoryRow` (see Types section); batch upsert (500 rows/batch) on `(provider_id, fiscal_year)` conflict. On conflict, **all non-key columns are overwritten** (`medicare_payments`, `total_charges`, `total_days`, `total_patients`, `data_source`), matching the Supabase default upsert behavior used by existing scripts.

9. **Update `providers`** — for the **highest fiscal year** present in the current zip per provider, update:
   - `annual_medicare_payments`
   - `payment_data_year`
   - `payment_data_source = 'hcris'`
   - `charge_to_payment_ratio` (see formula below)
   - `updated_at = NOW()`

   **Skip the `providers` update entirely for a given provider if `medicare_payments` is `null` for their highest fiscal year** (e.g. the worksheet coordinate was absent). Log a warning with the CCN. This prevents overwriting a previously-valid `annual_medicare_payments` with null.

10. **Log summary** — see Logging section below.

---

## Worksheet Coordinates

Coordinates are defined as typed constants in each `transform-hcris-*.ts` file, making them easy to audit and update if CMS changes a form.

> **Note:** These coordinates must be verified against actual HCRIS files before the first production run. CMS form instructions use different notation than raw file values (e.g. form says `E` but file contains `E00001`). The runbook includes a verification step for the operator.

**SNF (CMS-2540-10):**

| Field                        | WKSHT_CD | LINE_NUM | CLMN_NUM |
| ---------------------------- | -------- | -------- | -------- |
| Total Medicare reimbursement | `E`      | `1`      | `1`      |
| Total submitted charges      | `C`      | `1`      | `8`      |
| Medicare patient days        | `S3`     | `1`      | `6`      |
| Total patient days           | `S3`     | `1`      | `8`      |

**HHA (CMS-1728-20):**

| Field                        | WKSHT_CD | LINE_NUM | CLMN_NUM |
| ---------------------------- | -------- | -------- | -------- |
| Total Medicare reimbursement | `E`      | `1`      | `1`      |
| Total visits                 | `H1`     | `1`      | `1`      |
| Total patients               | `H1`     | `1`      | `2`      |

**Hospice (CMS-1984-14):**

| Field                           | WKSHT_CD | LINE_NUM | CLMN_NUM |
| ------------------------------- | -------- | -------- | -------- |
| Total Medicare reimbursement    | `E`      | `1`      | `1`      |
| Total patient days (all levels) | `S2`     | `1`      | `1`      |

---

## Types

```typescript
// Intermediate: extracted from HCRIS files, keyed by CCN
interface PaymentRecord {
  prvdr_num: string; // CCN (PRVDR_NUM from RPT file)
  fiscal_year: number; // calendar year of FY_END_DT
  medicare_payments: number | null;
  total_charges: number | null; // SNF only; null for HHA and Hospice
  total_days: number | null;
  total_patients: number | null; // HHA only; null for SNF and Hospice
  // Note: HHA total_visits is extracted for operational logging only;
  //       it is not stored — payment_history has no visits column.
}

// Final: ready to upsert into payment_history
interface PaymentHistoryRow {
  provider_id: string; // UUID from providers table
  fiscal_year: number;
  medicare_payments: number | null;
  total_charges: number | null;
  total_days: number | null;
  total_patients: number | null;
  data_source: "hcris";
}
```

---

## `charge_to_payment_ratio` Formula

```
charge_to_payment_ratio = total_charges / medicare_payments
```

- Result is `null` if either `total_charges` or `medicare_payments` is `null`
- Result is `null` if `medicare_payments` is `0` (avoid division by zero)
- Stored as `DECIMAL(6,2)` — rounded to 2 decimal places before writing

---

## Error Handling

| Scenario                                     | Behavior                                                |
| -------------------------------------------- | ------------------------------------------------------- |
| Provider CCN not found in `providers` table  | Log warning with CCN, increment missing count, continue |
| Expected NMRC coordinate absent for a report | Set field to `null`, continue                           |
| Zero rows upserted after full run            | Exit with code 1 (matches existing script convention)   |
| Upsert error from Supabase                   | Throw, halt run immediately                             |
| Zip extraction or CSV parse failure          | Throw, halt run; temp dir cleaned up in `finally`       |

---

## Logging

Each script logs a summary on completion:

```
--- HCRIS SNF Ingestion Summary ---
Fiscal years found:        2021, 2022, 2023
Reports processed:         14,802
Providers matched:         14,650  (found in DB)
Providers missing:            152  (CCN not found — logged above)
payment_history rows upserted: 14,650
providers updated:         14,650
Total Medicare revenue:    $42,847,203,441
```

---

## Testing

Test files live in `scripts/lib/__tests__/`, following the existing convention.

- **`hcris.test.ts`** — unit tests for shared logic:
  - Report selection: prefer settled over as-submitted for same provider-year
  - Report selection: prefer most recent `PROC_DT` among ties
  - `fiscal_year` derivation from `FY_END_DT`
  - RPT/NMRC join and grouping
  - CCN lookup batching (1000/batch)
- **`transform-hcris-snf.test.ts`**, **`transform-hcris-hha.test.ts`**, **`transform-hcris-hospice.test.ts`**:
  - Given mock NMRC rows, assert correct field extraction per coordinate
  - Null handling when a coordinate is absent
  - `charge_to_payment_ratio` calculation including zero and null edge cases
- Supabase and file I/O are mocked (same pattern as existing scripts)
- No integration tests against real HCRIS files — the runbook's verification step covers that

---

## Runbook

A `docs/hcris-quarterly-runbook.md` file will be created alongside the scripts. It will include:

1. Where to download each zip (exact CMS URLs per provider type)
2. How to verify the zip contents (expected file suffixes, approximate row counts)
3. How to verify worksheet coordinate values against the raw files (one-time setup step, and after any CMS form version change)
4. Exact commands to run each script with expected output
5. How to interpret the summary log and what to do if providers are missing
6. What to do if a run fails partway through (idempotency: re-running is safe due to upsert semantics on both `payment_history` and `providers`)

---

## Database Tables Affected

- **`payment_history`** — upserted on `(provider_id, fiscal_year)`; `data_source = 'hcris'`
- **`providers`** — updated: `annual_medicare_payments`, `payment_data_year`, `payment_data_source`, `charge_to_payment_ratio`, `updated_at`

No schema migrations required — both tables and all columns already exist.
