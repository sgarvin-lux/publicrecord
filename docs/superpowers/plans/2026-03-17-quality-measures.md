# CMS Quality Measures Ingestion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest CMS quality measures for all three provider types (SNF, HHA, Hospice) into a new `quality_measures` table and wire them up via a single runnable ingest script.

**Architecture:** Single ingest script (`scripts/ingest-quality-measures.ts`) orchestrates all three provider types. Each type has its own transform module under `scripts/lib/`. A shared lib (`scripts/lib/quality-measures.ts`) holds the `QualityMeasureRow` interface and the `parseScore` utility used by all three transforms.

**Tech Stack:** TypeScript, Vitest, Supabase JS client, CMS Provider Data API (`data.cms.gov`), PostgreSQL (via Supabase)

---

## File Structure

| File                                                             | Action | Responsibility                                                              |
| ---------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `supabase/migrations/20260317000011_create_quality_measures.sql` | Create | DDL for `quality_measures` table                                            |
| `src/lib/supabase/database.types.ts`                             | Modify | Add `quality_measures` table type                                           |
| `scripts/lib/quality-measures.ts`                                | Create | Shared `QualityMeasureRow` interface, `CmsRecord` type, `parseScore` helper |
| `scripts/lib/transform-quality-snf.ts`                           | Create | Transform SNF MDS long-format rows                                          |
| `scripts/lib/transform-quality-hha.ts`                           | Create | Unpivot HHA wide-format rows + national avg join                            |
| `scripts/lib/transform-quality-hospice.ts`                       | Create | Transform Hospice claims + CAHPS rows, merge and deduplicate                |
| `scripts/lib/__tests__/transform-quality-snf.test.ts`            | Create | Unit tests for SNF transform                                                |
| `scripts/lib/__tests__/transform-quality-hha.test.ts`            | Create | Unit tests for HHA transform                                                |
| `scripts/lib/__tests__/transform-quality-hospice.test.ts`        | Create | Unit tests for Hospice transform                                            |
| `scripts/ingest-quality-measures.ts`                             | Create | Ingest orchestrator: fetch, transform, upsert all three types               |

---

## Chunk 1: Migration, DB Types, Shared Types, SNF Transform

### Task 1: Migration and DB type update

**Files:**

- Create: `supabase/migrations/20260317000011_create_quality_measures.sql`
- Modify: `src/lib/supabase/database.types.ts`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260317000011_create_quality_measures.sql
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

- [ ] **Step 2: Apply the migration locally**

```bash
npx supabase db push
```

Expected: migration applies without error. If using remote DB only, apply via the Supabase dashboard SQL editor instead.

- [ ] **Step 3: Add the `quality_measures` type to `database.types.ts`**

Open `src/lib/supabase/database.types.ts`. Find the `public: { Tables: {` section. Add `quality_measures` in alphabetical order between `penalties` and `payment_history` (or wherever it fits alphabetically):

```typescript
quality_measures: {
  Row: {
    created_at: string | null;
    data_source: string | null;
    id: string;
    measure_code: string;
    measure_name: string | null;
    national_avg: number | null;
    period: string | null;
    provider_id: string;
    score: number | null;
    state_avg: number | null;
    updated_at: string | null;
  };
  Insert: {
    created_at?: string | null;
    data_source?: string | null;
    id?: string;
    measure_code: string;
    measure_name?: string | null;
    national_avg?: number | null;
    period?: string | null;
    provider_id: string;
    score?: number | null;
    state_avg?: number | null;
    updated_at?: string | null;
  };
  Update: {
    created_at?: string | null;
    data_source?: string | null;
    id?: string;
    measure_code?: string;
    measure_name?: string | null;
    national_avg?: number | null;
    period?: string | null;
    provider_id?: string;
    score?: number | null;
    state_avg?: number | null;
    updated_at?: string | null;
  };
  Relationships: [
    {
      foreignKeyName: "quality_measures_provider_id_fkey";
      columns: ["provider_id"];
      isOneToOne: false;
      referencedRelation: "providers";
      referencedColumns: ["id"];
    },
  ];
};
```

- [ ] **Step 4: Run typecheck to confirm no errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260317000011_create_quality_measures.sql src/lib/supabase/database.types.ts
git commit -m "feat: add quality_measures table migration and DB types"
```

---

### Task 2: Shared types and SNF transform

**Files:**

- Create: `scripts/lib/quality-measures.ts`
- Create: `scripts/lib/transform-quality-snf.ts`
- Create: `scripts/lib/__tests__/transform-quality-snf.test.ts`

#### Step 2a: Write the failing SNF tests first

- [ ] **Step 1: Create the test file**

```typescript
// scripts/lib/__tests__/transform-quality-snf.test.ts
import { describe, it, expect } from "vitest";
import { transformQualitySnf } from "../transform-quality-snf";

const lookup = new Map([["015001", "uuid-provider-1"]]);

describe("transformQualitySnf", () => {
  const baseRow = {
    cms_certification_number_ccn: "015001",
    measure_cd: "NH_QM_001",
    measure_description:
      "Percent of long-stay residents who received an antipsychotic",
    score: "14.5",
    national_rate: "15.2",
    state_average: "13.8",
    start_date: "04/01/2024",
    end_date: "03/31/2025",
  };

  it("transforms a complete SNF quality measure row", () => {
    const result = transformQualitySnf([baseRow], lookup);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      provider_id: "uuid-provider-1",
      measure_code: "NH_QM_001",
      measure_name:
        "Percent of long-stay residents who received an antipsychotic",
      score: 14.5,
      national_avg: 15.2,
      state_avg: 13.8,
      period: "04/01/2024-03/31/2025",
      data_source: "cms-mds",
    });
  });

  it("skips rows with unknown CCN", () => {
    const result = transformQualitySnf(
      [{ ...baseRow, cms_certification_number_ccn: "UNKNOWN" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("skips rows with empty CCN", () => {
    const result = transformQualitySnf(
      [{ ...baseRow, cms_certification_number_ccn: "" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("returns null score for 'Not Available'", () => {
    const result = transformQualitySnf(
      [{ ...baseRow, score: "Not Available" }],
      lookup,
    );
    expect(result[0].score).toBeNull();
  });

  it("returns null score for empty string", () => {
    const result = transformQualitySnf([{ ...baseRow, score: "" }], lookup);
    expect(result[0].score).toBeNull();
  });

  it("returns null period when start_date is empty", () => {
    const result = transformQualitySnf(
      [{ ...baseRow, start_date: "" }],
      lookup,
    );
    expect(result[0].period).toBeNull();
  });

  it("returns null period when end_date is undefined", () => {
    const { end_date: _, ...rowWithoutEnd } = baseRow;
    const result = transformQualitySnf([rowWithoutEnd], lookup);
    expect(result[0].period).toBeNull();
  });

  it("returns null national_avg when national_rate is empty", () => {
    const result = transformQualitySnf(
      [{ ...baseRow, national_rate: "" }],
      lookup,
    );
    expect(result[0].national_avg).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run scripts/lib/__tests__/transform-quality-snf.test.ts
```

Expected: FAIL with "Cannot find module '../transform-quality-snf'"

#### Step 2b: Implement the shared types and SNF transform

- [ ] **Step 3: Create the shared types file**

```typescript
// scripts/lib/quality-measures.ts
export type CmsRecord = Record<string, string | undefined>;

export interface QualityMeasureRow {
  provider_id: string;
  measure_code: string;
  measure_name: string | null;
  score: number | null;
  national_avg: number | null;
  state_avg: number | null;
  period: string | null;
  data_source: string;
}

export function parseScore(value: string | undefined): number | null {
  if (!value || value.trim() === "" || value.trim() === "Not Available")
    return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}
```

- [ ] **Step 4: Create the SNF transform**

```typescript
// scripts/lib/transform-quality-snf.ts
import {
  type CmsRecord,
  type QualityMeasureRow,
  parseScore,
} from "./quality-measures";

export function transformQualitySnf(
  rows: CmsRecord[],
  lookup: Map<string, string>,
): QualityMeasureRow[] {
  const result: QualityMeasureRow[] = [];
  for (const row of rows) {
    const ccn = row.cms_certification_number_ccn?.trim();
    if (!ccn) continue;
    const providerId = lookup.get(ccn);
    if (!providerId) continue;

    const startDate = row.start_date?.trim();
    const endDate = row.end_date?.trim();
    const period = startDate && endDate ? `${startDate}-${endDate}` : null;

    result.push({
      provider_id: providerId,
      measure_code: row.measure_cd?.trim() ?? "",
      measure_name: row.measure_description?.trim() ?? null,
      score: parseScore(row.score),
      national_avg: parseScore(row.national_rate),
      state_avg: parseScore(row.state_average),
      period,
      data_source: "cms-mds",
    });
  }
  return result;
}
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
npx vitest run scripts/lib/__tests__/transform-quality-snf.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 6: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/quality-measures.ts scripts/lib/transform-quality-snf.ts scripts/lib/__tests__/transform-quality-snf.test.ts
git commit -m "feat: add shared quality-measures types and SNF transform"
```

---

## Chunk 2: HHA Transform and Hospice Transform

### Task 3: HHA transform

**Files:**

- Create: `scripts/lib/transform-quality-hha.ts`
- Create: `scripts/lib/__tests__/transform-quality-hha.test.ts`

**Background:** Dataset `6jpm-sxkc` (HHA providers) is wide format — one row per provider, with quality measures as individual columns. The design spec estimated "~14 measures" but a live API sample showed only 5 numeric measure columns at the provider level — the outcome/process measures (walking, bathing, etc.) present in the national averages dataset are **not exposed at the provider level** in this endpoint. `HHA_MEASURES` contains the 5 confirmed provider-level columns. If CMS updates the endpoint to include more measures, add them to `HHA_MEASURES`.

**Verify this list before implementation** — fetch one row to confirm field names:

```bash
curl "https://data.cms.gov/provider-data/api/1/datastore/query/6jpm-sxkc/0?limit=1" | npx fx '.results[0]'
```

The confirmed numeric measure columns are listed in `HHA_MEASURES` below.

#### Step 3a: Write the failing HHA tests first

- [ ] **Step 1: Create the test file**

```typescript
// scripts/lib/__tests__/transform-quality-hha.test.ts
import { describe, it, expect } from "vitest";
import { transformQualityHha } from "../transform-quality-hha";

const lookup = new Map([["123456", "uuid-hha-1"]]);

const sampleProviderRow = {
  cms_certification_number_ccn: "123456",
  quality_of_patient_care_star_rating: "4.5",
  dtc_riskstandardized_rate: "89.38",
  pph_riskstandardized_rate: "7.64",
  covid19_vaccine_percent_of_patients_who_are_up_to_date: "32.91",
  how_much_medicare_spends_on_an_episode_of_care_at_this_agen_56e6: "0.94",
};

const sampleNationalRow = {
  quality_of_patient_care_star_rating: "3",
  dtc_national_observed_rate: "77.71",
  pph_national_observed_rate: "10.83",
  covid19_vaccine_percent_of_patients_who_are_up_to_date: "54.12",
  how_much_medicare_spends_on_an_episode_of_care_at_this_agen_56e6: "1.00",
};

describe("transformQualityHha", () => {
  it("produces one row per HHA_MEASURES entry per provider", () => {
    const result = transformQualityHha(
      [sampleProviderRow],
      sampleNationalRow,
      lookup,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.provider_id === "uuid-hha-1")).toBe(true);
    expect(result.every((r) => r.data_source === "cms-hha")).toBe(true);
    expect(result.every((r) => r.state_avg === null)).toBe(true);
    expect(result.every((r) => r.period === null)).toBe(true);
  });

  it("joins national averages correctly for DTC measure", () => {
    const result = transformQualityHha(
      [sampleProviderRow],
      sampleNationalRow,
      lookup,
    );
    const dtcRow = result.find((r) => r.measure_code === "HHA_DTC");
    expect(dtcRow).toBeDefined();
    expect(dtcRow?.score).toBe(89.38);
    expect(dtcRow?.national_avg).toBe(77.71);
  });

  it("sets national_avg to null for all rows when nationalRow is null", () => {
    const result = transformQualityHha([sampleProviderRow], null, lookup);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.national_avg === null)).toBe(true);
  });

  it("skips rows with unknown CCN", () => {
    const result = transformQualityHha(
      [{ ...sampleProviderRow, cms_certification_number_ccn: "UNKNOWN" }],
      sampleNationalRow,
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("handles missing measure value as null score", () => {
    const rowWithMissingScore = {
      ...sampleProviderRow,
      dtc_riskstandardized_rate: "",
    };
    const result = transformQualityHha(
      [rowWithMissingScore],
      sampleNationalRow,
      lookup,
    );
    const dtcRow = result.find((r) => r.measure_code === "HHA_DTC");
    expect(dtcRow?.score).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run scripts/lib/__tests__/transform-quality-hha.test.ts
```

Expected: FAIL with "Cannot find module '../transform-quality-hha'"

#### Step 3b: Implement the HHA transform

- [ ] **Step 3: Create the HHA transform**

```typescript
// scripts/lib/transform-quality-hha.ts
import {
  type CmsRecord,
  type QualityMeasureRow,
  parseScore,
} from "./quality-measures";

/**
 * Maps provider-level column names in dataset 6jpm-sxkc to stable measure
 * codes, human-readable names, and the corresponding column name in the
 * national averages dataset 97z8-de96.
 *
 * NOTE: This list is derived from the CMS API as of March 2026. If CMS adds
 * or renames columns, update this list. Verify by fetching a sample row:
 *   curl "https://data.cms.gov/provider-data/api/1/datastore/query/6jpm-sxkc/0?limit=1"
 */
const HHA_MEASURES = [
  {
    col: "quality_of_patient_care_star_rating",
    code: "HHA_QUALITY_STAR",
    name: "Quality of patient care star rating",
    national_col: "quality_of_patient_care_star_rating",
  },
  {
    col: "dtc_riskstandardized_rate",
    code: "HHA_DTC",
    name: "Discharged to community (risk-standardized rate)",
    national_col: "dtc_national_observed_rate",
  },
  {
    col: "pph_riskstandardized_rate",
    code: "HHA_PPH",
    name: "Potentially preventable hospitalizations (risk-standardized rate)",
    national_col: "pph_national_observed_rate",
  },
  {
    col: "covid19_vaccine_percent_of_patients_who_are_up_to_date",
    code: "HHA_COVID_VAX",
    name: "COVID-19 vaccine: patients up to date (%)",
    national_col: "covid19_vaccine_percent_of_patients_who_are_up_to_date",
  },
  {
    col: "how_much_medicare_spends_on_an_episode_of_care_at_this_agen_56e6",
    code: "HHA_SPENDING_RATIO",
    name: "Medicare spending per episode (ratio to national average)",
    national_col:
      "how_much_medicare_spends_on_an_episode_of_care_at_this_agen_56e6",
  },
] as const;

export function transformQualityHha(
  providerRows: CmsRecord[],
  nationalRow: CmsRecord | null,
  lookup: Map<string, string>,
): QualityMeasureRow[] {
  const result: QualityMeasureRow[] = [];

  for (const row of providerRows) {
    const ccn = row.cms_certification_number_ccn?.trim();
    if (!ccn) continue;
    const providerId = lookup.get(ccn);
    if (!providerId) continue;

    for (const m of HHA_MEASURES) {
      result.push({
        provider_id: providerId,
        measure_code: m.code,
        measure_name: m.name,
        score: parseScore(row[m.col]),
        national_avg: nationalRow
          ? parseScore(nationalRow[m.national_col])
          : null,
        state_avg: null,
        period: null,
        data_source: "cms-hha",
      });
    }
  }

  return result;
}
```

- [ ] **Step 4: Run the HHA tests and verify they pass**

```bash
npx vitest run scripts/lib/__tests__/transform-quality-hha.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/transform-quality-hha.ts scripts/lib/__tests__/transform-quality-hha.test.ts
git commit -m "feat: add HHA quality measures transform"
```

---

### Task 4: Hospice transform

**Files:**

- Create: `scripts/lib/transform-quality-hospice.ts`
- Create: `scripts/lib/__tests__/transform-quality-hospice.test.ts`

**Background:** Two datasets are fetched for hospice:

- `252m-zfp9` (claims-based measures, long format, `measure_code` field, ~38 measures)
- `gxki-hrr8` (CAHPS patient experience, long format, `measure_code` field, ~25 measures)
- `7cv8-v37d` (CAHPS national averages, one row per `measure_code`)

Claims codes look like `H_001_01_OBSERVED`; CAHPS codes look like `EMO_REL_BBV` — namespaces are disjoint. Both datasets use `cms_certification_number_ccn` as the CCN field.

#### Step 4a: Write the failing Hospice tests first

- [ ] **Step 1: Create the test file**

```typescript
// scripts/lib/__tests__/transform-quality-hospice.test.ts
import { describe, it, expect } from "vitest";
import { transformQualityHospice } from "../transform-quality-hospice";

const lookup = new Map([["999001", "uuid-hospice-1"]]);

const sampleClaimsRow = {
  cms_certification_number_ccn: "999001",
  measure_code: "H_001_01_OBSERVED",
  measure_name: "Hospice and Palliative Care - Pain Screening",
  score: "87.5",
  measure_date_range: "04/01/2024-03/31/2025",
};

const sampleCahpsRow = {
  cms_certification_number_ccn: "999001",
  measure_code: "EMO_REL_BBV",
  measure_name: "Emotional and Spiritual Support - Bottom Box",
  score: "11.3",
  date: "04/01/2023-03/31/2025",
};

const sampleCahpsNationalRow = {
  measure_code: "EMO_REL_BBV",
  measure_name: "Emotional and Spiritual Support - Bottom Box",
  score: "12.1",
};

describe("transformQualityHospice", () => {
  it("transforms claims rows with null national_avg", () => {
    const result = transformQualityHospice([sampleClaimsRow], [], [], lookup);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider_id: "uuid-hospice-1",
      measure_code: "H_001_01_OBSERVED",
      score: 87.5,
      national_avg: null,
      period: "04/01/2024-03/31/2025",
      data_source: "cms-hospice-claims",
    });
  });

  it("transforms CAHPS rows and joins national avg from nationalRows", () => {
    const result = transformQualityHospice(
      [],
      [sampleCahpsRow],
      [sampleCahpsNationalRow],
      lookup,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      measure_code: "EMO_REL_BBV",
      score: 11.3,
      national_avg: 12.1,
      period: "04/01/2023-03/31/2025",
      data_source: "cms-hospice-cahps",
    });
  });

  it("sets CAHPS national_avg to null when measure_code not in national rows", () => {
    const result = transformQualityHospice(
      [],
      [sampleCahpsRow],
      [], // empty national rows
      lookup,
    );
    expect(result[0].national_avg).toBeNull();
  });

  it("skips rows with unknown CCN", () => {
    const result = transformQualityHospice(
      [{ ...sampleClaimsRow, cms_certification_number_ccn: "UNKNOWN" }],
      [],
      [],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("merges claims and CAHPS rows with disjoint measure codes", () => {
    const result = transformQualityHospice(
      [sampleClaimsRow],
      [sampleCahpsRow],
      [sampleCahpsNationalRow],
      lookup,
    );
    expect(result).toHaveLength(2);
    const codes = result.map((r) => r.measure_code);
    expect(codes).toContain("H_001_01_OBSERVED");
    expect(codes).toContain("EMO_REL_BBV");
  });

  it("handles 'Not Available' score as null", () => {
    const result = transformQualityHospice(
      [{ ...sampleClaimsRow, score: "Not Available" }],
      [],
      [],
      lookup,
    );
    expect(result[0].score).toBeNull();
  });

  it("skips claims rows with missing measure_code", () => {
    const result = transformQualityHospice(
      [{ ...sampleClaimsRow, measure_code: "" }],
      [],
      [],
      lookup,
    );
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run scripts/lib/__tests__/transform-quality-hospice.test.ts
```

Expected: FAIL with "Cannot find module '../transform-quality-hospice'"

#### Step 4b: Implement the Hospice transform

- [ ] **Step 3: Create the Hospice transform**

```typescript
// scripts/lib/transform-quality-hospice.ts
import {
  type CmsRecord,
  type QualityMeasureRow,
  parseScore,
} from "./quality-measures";

function buildNationalMap(nationalRows: CmsRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of nationalRows) {
    const code = row.measure_code?.trim();
    const score = parseScore(row.score);
    if (code && score !== null) {
      map.set(code, score);
    }
  }
  return map;
}

function transformClaims(
  rows: CmsRecord[],
  lookup: Map<string, string>,
): QualityMeasureRow[] {
  const result: QualityMeasureRow[] = [];
  for (const row of rows) {
    const ccn = row.cms_certification_number_ccn?.trim();
    if (!ccn) continue;
    const providerId = lookup.get(ccn);
    if (!providerId) continue;
    const code = row.measure_code?.trim();
    if (!code) continue;

    result.push({
      provider_id: providerId,
      measure_code: code,
      measure_name: row.measure_name?.trim() ?? null,
      score: parseScore(row.score),
      national_avg: null,
      state_avg: null,
      period: row.measure_date_range?.trim() ?? null,
      data_source: "cms-hospice-claims",
    });
  }
  return result;
}

function transformCahps(
  rows: CmsRecord[],
  nationalMap: Map<string, number | null>,
  lookup: Map<string, string>,
): QualityMeasureRow[] {
  const result: QualityMeasureRow[] = [];
  for (const row of rows) {
    const ccn = row.cms_certification_number_ccn?.trim();
    if (!ccn) continue;
    const providerId = lookup.get(ccn);
    if (!providerId) continue;
    const code = row.measure_code?.trim();
    if (!code) continue;

    result.push({
      provider_id: providerId,
      measure_code: code,
      measure_name: row.measure_name?.trim() ?? null,
      score: parseScore(row.score),
      national_avg: nationalMap.get(code) ?? null,
      state_avg: null,
      period: row.date?.trim() ?? null,
      data_source: "cms-hospice-cahps",
    });
  }
  return result;
}

export function transformQualityHospice(
  claimsRows: CmsRecord[],
  cahpsRows: CmsRecord[],
  nationalRows: CmsRecord[],
  lookup: Map<string, string>,
): QualityMeasureRow[] {
  const nationalMap = buildNationalMap(nationalRows);
  const claims = transformClaims(claimsRows, lookup);
  const cahps = transformCahps(cahpsRows, nationalMap, lookup);

  // Deduplicate by (provider_id, measure_code) — last-writer-wins
  // Claims and CAHPS use disjoint code namespaces, so collisions are unexpected.
  const merged = new Map<string, QualityMeasureRow>();
  for (const row of [...claims, ...cahps]) {
    const key = `${row.provider_id}:${row.measure_code}`;
    if (merged.has(key)) {
      console.warn(
        `Hospice measure code collision: ${row.measure_code} for provider ${row.provider_id}`,
      );
    }
    merged.set(key, row);
  }
  return [...merged.values()];
}
```

- [ ] **Step 4: Run the Hospice tests and verify they pass**

```bash
npx vitest run scripts/lib/__tests__/transform-quality-hospice.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/transform-quality-hospice.ts scripts/lib/__tests__/transform-quality-hospice.test.ts
git commit -m "feat: add Hospice quality measures transform"
```

---

## Chunk 3: Ingest Script

### Task 5: Ingest orchestrator

**Files:**

- Create: `scripts/ingest-quality-measures.ts`

**Background:** This script follows the same pattern as `scripts/ingest-providers.ts` and `scripts/ingest-penalties.ts`. Key differences:

- Provider lookup uses paginated `SELECT cms_id, id FROM providers` with `.range()` because quality measures reference nearly all ~30K providers (Supabase's default 1000-row limit would silently truncate).
- HHA national avg fetch is wrapped in try/catch — if it fails, HHA rows are upserted with `national_avg: null`.
- Three types are upserted separately to preserve per-type counts.
- `process.exit(1)` if total upserted is 0.

No unit tests for this file (consistent with `ingest-providers.ts` and `ingest-penalties.ts` — they test transforms, not the orchestrator).

- [ ] **Step 1: Create the ingest script**

```typescript
// scripts/ingest-quality-measures.ts
import { fetchAllPages } from "./lib/cms-api";
import { supabaseAdmin } from "./lib/supabase-admin";
import { type QualityMeasureRow, type CmsRecord } from "./lib/quality-measures";

// Note: CmsRecord is used in extractCcns() parameter type; QualityMeasureRow is used in upsert helpers.
import { transformQualitySnf } from "./lib/transform-quality-snf";
import { transformQualityHha } from "./lib/transform-quality-hha";
import { transformQualityHospice } from "./lib/transform-quality-hospice";

const UPSERT_BATCH_SIZE = 500;
const PROVIDER_PAGE_SIZE = 1000;

/**
 * Fetches all providers in paginated batches and returns a Map<cms_id, uuid>.
 * A plain .select() would silently return only the first 1000 rows from Supabase.
 */
async function buildProviderLookup(): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("id, cms_id")
      .range(from, from + PROVIDER_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load providers: ${error.message}`);
    for (const row of data ?? []) {
      lookup.set(row.cms_id, row.id);
    }
    if ((data ?? []).length < PROVIDER_PAGE_SIZE) break;
    from += PROVIDER_PAGE_SIZE;
  }
  return lookup;
}

async function upsertBatch(batch: QualityMeasureRow[]): Promise<number> {
  const { error, count } = await supabaseAdmin
    .from("quality_measures")
    .upsert(batch, {
      onConflict: "provider_id,measure_code",
      count: "exact",
    });
  if (error) throw new Error(`Upsert failed: ${error.message}`);
  return count ?? batch.length;
}

async function upsertRows(rows: QualityMeasureRow[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    total += await upsertBatch(batch);
    console.log(
      `  Upserted batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}: ${batch.length} rows`,
    );
  }
  return total;
}

function extractCcns(rawRows: CmsRecord[]): Set<string> {
  const ccns = new Set<string>();
  for (const row of rawRows) {
    const ccn = row.cms_certification_number_ccn?.trim();
    if (ccn) ccns.add(ccn);
  }
  return ccns;
}

function countMatched(
  rawCcns: Set<string>,
  lookup: Map<string, string>,
): { matched: number; missing: number } {
  let matched = 0;
  for (const ccn of rawCcns) {
    if (lookup.has(ccn)) matched++;
  }
  return { matched, missing: rawCcns.size - matched };
}

export async function main() {
  console.log("Starting CMS quality measures ingestion...");

  console.log("Building provider lookup (paginated)...");
  const lookup = await buildProviderLookup();
  console.log(`Loaded ${lookup.size} providers`);

  let totalUpserted = 0;

  // --- SNF ---
  console.log("\nFetching SNF MDS quality measures (djen-97ju)...");
  const snfRaw = await fetchAllPages("djen-97ju");
  const snfRows = transformQualitySnf(snfRaw, lookup);
  const snfCcns = extractCcns(snfRaw);
  const snfStats = countMatched(snfCcns, lookup);
  console.log(
    `SNF: ${snfRows.length} rows from ${snfCcns.size} CCNs — ${snfStats.matched} matched, ${snfStats.missing} missing`,
  );
  const snfUpserted = await upsertRows(snfRows);
  totalUpserted += snfUpserted;

  // --- HHA ---
  console.log("\nFetching HHA quality measures (6jpm-sxkc)...");
  const hhaProviderRaw = await fetchAllPages("6jpm-sxkc");
  let hhaNationalRow: CmsRecord | null = null;
  try {
    const hhaNationalRaw = await fetchAllPages("97z8-de96");
    hhaNationalRow = hhaNationalRaw[0] ?? null;
    if (!hhaNationalRow) {
      console.warn(
        "HHA national avg dataset returned no rows — national_avg will be null",
      );
    }
  } catch (err) {
    console.warn(
      "Failed to fetch HHA national averages — national_avg will be null:",
      err instanceof Error ? err.message : String(err),
    );
  }
  const hhaRows = transformQualityHha(hhaProviderRaw, hhaNationalRow, lookup);
  const hhaCcns = extractCcns(hhaProviderRaw);
  const hhaStats = countMatched(hhaCcns, lookup);
  console.log(
    `HHA: ${hhaRows.length} rows from ${hhaCcns.size} CCNs — ${hhaStats.matched} matched, ${hhaStats.missing} missing`,
  );
  const hhaUpserted = await upsertRows(hhaRows);
  totalUpserted += hhaUpserted;

  // --- Hospice ---
  console.log(
    "\nFetching Hospice quality measures (252m-zfp9, gxki-hrr8, 7cv8-v37d)...",
  );
  const hospiceClaimsRaw = await fetchAllPages("252m-zfp9");
  const hospiceCahpsRaw = await fetchAllPages("gxki-hrr8");
  const hospiceCahpsNationalRaw = await fetchAllPages("7cv8-v37d");
  const hospiceRows = transformQualityHospice(
    hospiceClaimsRaw,
    hospiceCahpsRaw,
    hospiceCahpsNationalRaw,
    lookup,
  );
  const hospiceCcns = new Set([
    ...extractCcns(hospiceClaimsRaw),
    ...extractCcns(hospiceCahpsRaw),
  ]);
  const hospiceStats = countMatched(hospiceCcns, lookup);
  console.log(
    `Hospice: ${hospiceRows.length} rows from ${hospiceCcns.size} CCNs — ${hospiceStats.matched} matched, ${hospiceStats.missing} missing`,
  );
  const hospiceUpserted = await upsertRows(hospiceRows);
  totalUpserted += hospiceUpserted;

  // --- Summary ---
  console.log("\n--- Quality Measures Ingestion Summary ---");
  console.log(
    `SNF:     ${snfRows.length} rows produced, ${snfStats.matched} providers matched, ${snfStats.missing} missing, ${snfUpserted} upserted`,
  );
  console.log(
    `HHA:     ${hhaRows.length} rows produced, ${hhaStats.matched} providers matched, ${hhaStats.missing} missing, ${hhaUpserted} upserted`,
  );
  console.log(
    `Hospice: ${hospiceRows.length} rows produced, ${hospiceStats.matched} providers matched, ${hospiceStats.missing} missing, ${hospiceUpserted} upserted`,
  );
  console.log(`Total:   ${totalUpserted} rows upserted`);

  if (totalUpserted === 0) {
    console.error("Zero records upserted — exiting with failure");
    process.exit(1);
  }

  console.log("\nIngestion complete.");
}

// Only auto-run when executed directly as a script, not when imported by tests
const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Ingestion failed:", error);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Run typecheck to confirm no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-quality-measures.ts
git commit -m "feat: add quality measures ingest script"
```

- [ ] **Step 5: Run the script against the production database**

First set env vars:

```bash
set -a && source .env.local && set +a
```

Then run:

```bash
npx tsx scripts/ingest-quality-measures.ts
```

Expected output (approximate):

```
Starting CMS quality measures ingestion...
Building provider lookup (paginated)...
Loaded ~30000 providers

Fetching SNF MDS quality measures (djen-97ju)...
SNF: ~300000 rows from ~15000 CCNs — ~14000 matched, ~1000 missing
  Upserted batch 1: 500 rows
  ...
SNF: ~280000 rows upserted

Fetching HHA quality measures (6jpm-sxkc)...
HHA: ~60000 rows from ~12000 CCNs — ~11000 matched, ~1000 missing
  ...
HHA: ~55000 rows upserted

Fetching Hospice quality measures...
Hospice: ~300000 rows from ~5500 CCNs — ~5000 matched, ~500 missing
  ...
Hospice: ~290000 rows upserted

--- Quality Measures Ingestion Summary ---
SNF:     ~300000 rows produced, ~14000 providers matched, ~1000 missing, ~280000 upserted
HHA:     ~60000 rows produced, ~11000 providers matched, ~1000 missing, ~55000 upserted
Hospice: ~300000 rows produced, ~5000 providers matched, ~500 missing, ~290000 upserted
Total:   ~625000 rows upserted

Ingestion complete.
```

If "Providers missing" exceeds 10% for any type, investigate CCN format mismatches.

- [ ] **Step 6: Verify data in the database**

Confirm all three provider types are represented:

```sql
SELECT data_source, COUNT(*) as row_count, COUNT(DISTINCT provider_id) as provider_count
FROM quality_measures
GROUP BY data_source
ORDER BY data_source;
```

Expected: rows for `cms-mds`, `cms-hha`, `cms-hospice-claims`, `cms-hospice-cahps` — all with non-zero counts.

Run a cross-provider query to confirm the `measure_code` index is working:

```sql
SELECT measure_code, COUNT(*) as provider_count, AVG(score) as avg_score
FROM quality_measures
WHERE data_source = 'cms-mds'
GROUP BY measure_code
ORDER BY provider_count DESC
LIMIT 10;
```

Expected: 10 rows with measure codes, provider counts in the thousands, and non-null avg_score values.

- [ ] **Step 7: Verify idempotency — re-run the script**

```bash
npx tsx scripts/ingest-quality-measures.ts
```

Expected: same total upserted count as the first run (upserts overwrite, no duplicates).

- [ ] **Step 8: Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix: address quality measures ingestion issues found during test run"
```

(Skip if no changes needed after the test run.)
