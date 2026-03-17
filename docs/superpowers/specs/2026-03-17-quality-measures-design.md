# CMS Quality Measures Ingestion — Design Spec (PUB-5)

## Overview

Ingest quality measure data for all three provider types (nursing home, home health, hospice) from CMS public APIs into a new `quality_measures` table. Measures are used on the provider detail Quality tab and as inputs to the risk score (PUB-10).

---

## CMS Data Sources

| Provider Type | Dataset ID | Format | Notes |
|---|---|---|---|
| SNF quality measures (MDS) | `djen-97ju` | Long (1 row/provider+measure) | ~20 measures, includes state + national avg. **Separate from** the nursing home provider dataset `4pq5-n9py` used by `ingest-providers.ts`. CMS data catalog: https://data.cms.gov/provider-data/dataset/djen-97ju |
| HHA providers | `6jpm-sxkc` | Wide (1 row/provider) | ~14 measures as columns; same dataset as provider ingestion |
| HHA national avg | `97z8-de96` | 1-row summary | Same column names as `6jpm-sxkc` |
| Hospice claims | `252m-zfp9` | Long | ~38 measures; same dataset as provider ingestion |
| Hospice CAHPS providers | `gxki-hrr8` | Long | ~25 patient experience measures |
| Hospice CAHPS national avg | `7cv8-v37d` | Long (1 row/measure) | Joined to `gxki-hrr8` on `measure_code` |

All datasets are fetched via the existing `fetchAllPages(datasetId)` utility in `scripts/lib/cms-api.ts`.

---

## Database Schema

New migration: `quality_measures` table.

```sql
CREATE TABLE quality_measures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  measure_code VARCHAR NOT NULL,
  measure_name VARCHAR,
  score DECIMAL(8,2),
  national_avg DECIMAL(8,2),
  state_avg DECIMAL(8,2),
  period VARCHAR,
  data_source VARCHAR,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_quality_measures_provider_measure
  ON quality_measures(provider_id, measure_code);

CREATE INDEX idx_quality_measures_measure_code
  ON quality_measures(measure_code);

CREATE TRIGGER quality_measures_updated_at
  BEFORE UPDATE ON quality_measures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

**Design decisions:**
- **Latest period only** — upsert on `(provider_id, measure_code)` overwrites the previous period. No history retained in M3 (trend data is a future feature).
- **`state_avg` nullable** — CMS does not publish state-level averages for HHA or Hospice; only SNF has state averages.
- **`measure_code` index** — supports cross-provider ranking queries needed for risk scoring (e.g., "all SNFs ranked by readmission rate").
- **`updated_at` trigger** — consistent with `providers` and `profiles` (note: `penalties` and `deficiencies` do not have `updated_at`). Requires `update_updated_at()` function from migration `20260317000002_create_profiles.sql` — the quality measures migration must run after it.

---

## Shared Output Type

All three transform modules produce the same row type:

```typescript
interface QualityMeasureRow {
  provider_id: string;       // UUID resolved from cms_id via lookup map
  measure_code: string;
  measure_name: string | null;
  score: number | null;
  national_avg: number | null;
  state_avg: number | null;
  period: string | null;
  data_source: string;       // e.g. "cms-mds", "cms-hha", "cms-hospice-claims", "cms-hospice-cahps"
}
```

---

## Transform Layer

### `scripts/lib/transform-quality-snf.ts`

Dataset `djen-97ju` is already in long format (one row per provider+measure). Raw CMS API field names → output:

- `cms_certification_number_ccn` → CCN for lookup
- `measure_cd` → `measure_code`
- `measure_description` → `measure_name`
- `score` → `score` (parse as float; may be `"Not Available"` or empty → `null`)
- `national_rate` → `national_avg` (parse as float; may be empty → `null`)
- `state_average` → `state_avg` (parse as float; may be empty → `null`)
- `start_date` + `end_date` → `period` formatted as `"${start_date}-${end_date}"` using an ASCII hyphen-minus (`-`, U+002D), e.g. `"04/01/2024-03/31/2025"`. If either field is empty or missing, emit `period: null`. Do not parse as a date.
- `data_source: "cms-mds"`

Transform functions use `Record<string, string | undefined>` as the raw record parameter type (the `CmsRecord` pattern from `transform-providers.ts`). `fetchAllPages` returns `Record<string, string>[]`. In TypeScript, `string` is a subtype of `string | undefined` so index signature covariance means this assignment is valid without a cast — but if the compiler rejects it, declare a local `CmsRecord` type alias as in `transform-providers.ts` and cast there.

Rows where `cms_certification_number_ccn` does not resolve in the lookup map are skipped (provider not in DB).

### `scripts/lib/transform-quality-hha.ts`

Dataset `6jpm-sxkc` is wide format — measures are column names, not rows. Requires unpivoting.

**Approach:** A hardcoded `HHA_MEASURES` array maps CMS column names to stable measure codes and human-readable names:

```typescript
const HHA_MEASURES = [
  { col: "how_often_patients_got_better_at_walking_or_moving_around", code: "HHA_WALK", name: "Patients who got better at walking" },
  { col: "discharge_function_score", code: "HHA_DISCHARGE_FUNCTION", name: "Discharge function score" },
  { col: "dtc_riskstandardized_rate", code: "HHA_DTC", name: "Discharged to community (risk-standardized)" },
  { col: "ppr_riskstandardized_rate", code: "HHA_PPR", name: "Potentially preventable readmissions (risk-standardized)" },
  { col: "pph_riskstandardized_rate", code: "HHA_PPH", name: "Potentially preventable hospitalizations (risk-standardized)" },
  // ... remaining ~9 measures
] as const;
```

The national averages dataset `97z8-de96` uses the standard CMS datastore query API (same `/api/1/datastore/query/` endpoint as all other datasets). Fetch via `fetchAllPages("97z8-de96")`; the caller extracts `rows[0]` and passes it to the transform as a single `Record<string, string | undefined> | null`. If `fetchAllPages` throws or returns an empty array, catch the error, log a warning, and pass `null` — the transform should emit `national_avg: null` for all HHA rows and continue normally with the HHA upsert. The `transformQualityHha` function signature must accept `null` for this parameter: `transformQualityHha(providerRows: CmsRecord[], nationalRow: CmsRecord | null, lookup: Map<string, string>): QualityMeasureRow[]`. For each provider row, one `QualityMeasureRow` is emitted per entry in `HHA_MEASURES`. `state_avg` is always `null`. `period` is `null` (CMS does not include a period field in this dataset); downstream consumers (Quality tab, PUB-10 risk scoring) must handle null periods — they should not filter or sort by period for HHA.

`data_source: "cms-hha"`

### `scripts/lib/transform-quality-hospice.ts`

Two long-format datasets, both normalized to `QualityMeasureRow`:

**Claims (`252m-zfp9`):** Raw CMS API field names:
- `cms_certification_number_ccn` → CCN for lookup
- `measure_code` → `measure_code` (literal field name in the API response)
- `measure_name` → `measure_name`
- `score` → `score` (parse as float; may be `"Not Available"` or empty → `null`)
- `measure_date_range` → `period` (stored as-is, e.g. `"04/01/2024-03/31/2025"`)
- No national average in this dataset → `national_avg: null`
- `data_source: "cms-hospice-claims"`

**CAHPS (`gxki-hrr8`):** Raw CMS API field names:
- `cms_certification_number_ccn` → CCN for lookup (same field name as claims dataset)
- `measure_code` → `measure_code` (literal field name in the API response)
- `measure_name` → `measure_name`
- `score` → `score` (parse as float; may be `"Not Available"` or empty → `null`)
- `date` → `period` (stored as-is, e.g. `"04/01/2023-03/31/2025"`)
- National avg joined from `7cv8-v37d` on `measure_code` → `national_avg`
- `data_source: "cms-hospice-cahps"`

Both are returned from a single `transformQualityHospice` call. `transformQualityHospice` receives `(claimsRows, cahpsRows, nationalRows, lookup)` where `nationalRows` is the raw array from `fetchAllPages("7cv8-v37d")`. The function builds a `Map<string, number>` from `nationalRows` keyed on `measure_code` internally before joining to CAHPS rows.

The combined claims + CAHPS rows are deduplicated by `(provider_id, measure_code)` within the transform (last-writer-wins on conflicts) before being returned. If a collision is detected, log a warning with the conflicting measure code.

**Measure code namespaces are disjoint:** Claims codes follow the pattern `H_001_01_OBSERVED`, `H_002_01_DENOMINATOR`, etc. CAHPS codes follow the pattern `EMO_REL_BBV`, `RATING_TBV`, `SUMMARY_STAR_RATING`, etc. There is no overlap in current CMS data, but the deduplication step above provides a safety net if CMS changes this.

---

## Ingest Script

**`scripts/ingest-quality-measures.ts`** — single script, runs all three types in sequence:

1. **Build CCN→UUID lookup** — paginate `SELECT cms_id, id FROM providers` using `.range()` until all rows are fetched. Supabase's default row limit is 1000 rows — a single unranged `.select()` will silently return only the first 1000 providers and cause the vast majority of CCNs to appear as "not found." Use a loop: fetch pages of 1000 until the returned page is shorter than the page size. Store all results in a `Map<string, string>` for O(1) lookups.
2. **SNF** — `fetchAllPages("djen-97ju")` → `transformQualitySnf(rows, lookup)`
3. **HHA** — `fetchAllPages("6jpm-sxkc")` + `fetchAllPages("97z8-de96")` → `transformQualityHha(providerRows, nationalRow, lookup)`
4. **Hospice** — `fetchAllPages("252m-zfp9")` + `fetchAllPages("gxki-hrr8")` + `fetchAllPages("7cv8-v37d")` → `transformQualityHospice(claimsRows, cahpsRows, nationalRows, lookup)`
5. **Upsert per type** — each type's rows are upserted separately (not merged into one array) so per-type upserted counts are available for the summary. Batch size 500, `onConflict: "provider_id,measure_code"`.
6. **Summary** — print per-type counts: rows produced, providers matched (distinct CCNs from that dataset's raw rows that resolved to a DB UUID), providers missing (distinct CCNs that did not resolve), rows upserted. Follow the pattern in `ingest-penalties.ts` for how to compute matched/missing from the lookup map. If total upserted across all types is 0, log an error and `process.exit(1)` — consistent with `ingest-providers.ts` and `ingest-penalties.ts`.

The script follows the same `export async function main()` + `isDirectRun` guard pattern as `ingest-providers.ts`.

**Note on dataset overlap:** `252m-zfp9` is also fetched by `ingest-providers.ts`. The two scripts are independent runs — the double fetch is intentional and acceptable.

---

## Testing

One test file per transform module, following the pattern of existing `scripts/lib/__tests__/transform-*.test.ts`:

- **`transform-quality-snf.test.ts`** — fixture long-format row → expected `QualityMeasureRow`; row with unknown CCN → skipped; `"Not Available"` score → `null`; missing `start_date` → `period: null`
- **`transform-quality-hha.test.ts`** — fixture wide row + national avg row → N measure rows (one per `HHA_MEASURES` entry); verifies unpivot logic and national avg join; `null` national avg row → all rows have `national_avg: null`
- **`transform-quality-hospice.test.ts`** — claims path: fixture row → row with null national avg; CAHPS path: fixture row + national avg fixture → row with national avg populated; unknown CCN → skipped

No DB integration tests (consistent with the rest of the codebase).

---

## Acceptance Criteria

- [ ] `quality_measures` table exists with unique constraint on `(provider_id, measure_code)`
- [ ] `ingest-quality-measures.ts` runs successfully against prod DB and prints a summary
- [ ] All three provider types are represented in the table
- [ ] Cross-provider queries by `measure_code` return correct results (verified manually)
- [ ] All transform unit tests pass
- [ ] Script is idempotent — re-running produces same results, no duplicates
