# Utilization PUF Ingestion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Medicare PAC Utilization PUF data for SNF, HHA, and Hospice into `payment_history`, filling gaps where HCRIS data is absent.

**Architecture:** Two new files — `scripts/lib/puf.ts` (pure helpers + I/O utilities) and `scripts/ingest-puf.ts` (thin orchestrator). All three PUF CSVs share the same column structure, so one `transformPufRows()` handles all three. PUF never overwrites HCRIS: `payment_history` upserts use `ignoreDuplicates: true`; provider updates use a `.is("payment_data_source", null)` DB guard.

**Tech Stack:** TypeScript, Supabase JS client, Node.js `readline`, Vitest

---

## File Structure

| File                                | Action | Responsibility                                                                                                                                  |
| ----------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/lib/puf.ts`                | Create | Types, `parseAmount`, `transformPufRows`, `buildPufProviderUpdates`, `fetchAndParsePufCsv`, `upsertPufPaymentHistory`, `updateProvidersFromPuf` |
| `scripts/lib/__tests__/puf.test.ts` | Create | Unit tests for all pure functions                                                                                                               |
| `scripts/ingest-puf.ts`             | Create | Orchestrator: fetch → resolve → transform → upsert → update → summary                                                                           |

---

## Chunk 1: `puf.ts` pure functions + tests

### Task 1: Pure functions in `puf.ts` and their tests

**Files:**

- Create: `scripts/lib/puf.ts`
- Create: `scripts/lib/__tests__/puf.test.ts`

**Context:**

- `resolveProviders` and `computeChargeToPaymentRatio` are already exported from `scripts/lib/hcris.ts` — import from there, do not reimplement.
- The existing `hcris.ts` `upsertPaymentHistory` uses `DO UPDATE` (overwrites). This is intentionally different: PUF uses `ignoreDuplicates: true` (`DO NOTHING`). Do not model PUF functions on HCRIS equivalents.
- `payment_history` table: columns `provider_id`, `fiscal_year`, `medicare_payments`, `total_charges`, `total_days`, `total_patients`, `data_source` (all nullable except `provider_id`/`fiscal_year`). Unique index on `(provider_id, fiscal_year)`.
- `providers` table: `payment_data_source VARCHAR` (nullable), `annual_medicare_payments`, `payment_data_year`, `charge_to_payment_ratio`.

- [ ] **Step 1: Write the failing tests**

```typescript
// scripts/lib/__tests__/puf.test.ts
import { describe, it, expect } from "vitest";
import {
  parseAmount,
  transformPufRows,
  buildPufProviderUpdates,
  type PufPaymentHistoryRow,
} from "../puf";

const lookup = new Map([
  ["010001", "uuid-provider-1"],
  ["010002", "uuid-provider-2"],
]);

const baseRow: Record<string, string> = {
  SMRY_CTGRY: "PROVIDER",
  PRVDR_ID: "010001",
  YEAR: "2023",
  TOT_MDCR_PYMT_AMT: "797586",
  TOT_CHRG_AMT: "9659610",
  TOT_SRVC_DAYS: "1202",
  BENE_DSTNCT_CNT: "83",
};

const basePufRow: PufPaymentHistoryRow = {
  provider_id: "uuid-provider-1",
  fiscal_year: 2023,
  medicare_payments: 797586,
  total_charges: 9659610,
  total_days: 1202,
  total_patients: 83,
  data_source: "utilization_puf",
};

describe("parseAmount", () => {
  it("returns null for *", () => expect(parseAmount("*")).toBeNull());
  it("returns null for empty string", () => expect(parseAmount("")).toBeNull());
  it("returns null for non-numeric", () =>
    expect(parseAmount("abc")).toBeNull());
  it("parses large integer", () =>
    expect(parseAmount("25968510365")).toBe(25968510365));
  it("parses regular integer", () =>
    expect(parseAmount("797586")).toBe(797586));
});

describe("transformPufRows", () => {
  it("transforms a complete provider row", () => {
    const result = transformPufRows([baseRow], lookup);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      provider_id: "uuid-provider-1",
      fiscal_year: 2023,
      medicare_payments: 797586,
      total_charges: 9659610,
      total_days: 1202,
      total_patients: 83,
      data_source: "utilization_puf",
    });
  });

  it("skips non-PROVIDER rows", () => {
    const result = transformPufRows(
      [{ ...baseRow, SMRY_CTGRY: "NATION" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("skips STATE rows", () => {
    const result = transformPufRows(
      [{ ...baseRow, SMRY_CTGRY: "STATE" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("skips rows with unknown CCN", () => {
    const result = transformPufRows(
      [{ ...baseRow, PRVDR_ID: "UNKNOWN" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("returns null for suppressed (*) amounts", () => {
    const result = transformPufRows(
      [{ ...baseRow, TOT_CHRG_AMT: "*" }],
      lookup,
    );
    expect(result[0].total_charges).toBeNull();
  });

  it("returns null for empty amounts", () => {
    const result = transformPufRows(
      [{ ...baseRow, TOT_MDCR_PYMT_AMT: "" }],
      lookup,
    );
    expect(result[0].medicare_payments).toBeNull();
  });
});

describe("buildPufProviderUpdates", () => {
  it("returns update when payment_data_source is null", () => {
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([basePufRow], dataSources);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider_id: "uuid-provider-1",
      annual_medicare_payments: 797586,
      payment_data_year: 2023,
      payment_data_source: "utilization_puf",
    });
  });

  it("skips provider when payment_data_source is already set", () => {
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", "hcris"],
    ]);
    const result = buildPufProviderUpdates([basePufRow], dataSources);
    expect(result).toHaveLength(0);
  });

  it("picks highest fiscal year for same provider across datasets", () => {
    const older = {
      ...basePufRow,
      fiscal_year: 2022,
      medicare_payments: 500000,
    };
    const newer = {
      ...basePufRow,
      fiscal_year: 2023,
      medicare_payments: 797586,
    };
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([older, newer], dataSources);
    expect(result).toHaveLength(1);
    expect(result[0].payment_data_year).toBe(2023);
    expect(result[0].annual_medicare_payments).toBe(797586);
  });

  it("skips provider when medicare_payments is null", () => {
    const row = { ...basePufRow, medicare_payments: null };
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([row], dataSources);
    expect(result).toHaveLength(0);
  });

  it("computes charge_to_payment_ratio", () => {
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([basePufRow], dataSources);
    // 9659610 / 797586 ≈ 12.11
    expect(result[0].charge_to_payment_ratio).toBeCloseTo(12.11, 1);
  });

  it("sets charge_to_payment_ratio to null when total_charges is null", () => {
    const row = { ...basePufRow, total_charges: null };
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([row], dataSources);
    expect(result[0].charge_to_payment_ratio).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/lib/__tests__/puf.test.ts
```

Expected: FAIL with "Cannot find module '../puf'"

- [ ] **Step 3: Implement pure functions in `puf.ts`**

```typescript
// scripts/lib/puf.ts
import { computeChargeToPaymentRatio } from "./hcris";

// ─── Types ─────────────────────────────────────────────────────────────────

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

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse a CMS PUF numeric field to number | null.
 * Returns null for suppressed values ("*"), empty strings, and non-numerics.
 */
export function parseAmount(value: string | undefined): number | null {
  if (!value || value.trim() === "" || value.trim() === "*") return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

// ─── Transform ─────────────────────────────────────────────────────────────

/**
 * Filter and map raw PUF CSV rows to PufPaymentHistoryRow records.
 * Skips non-PROVIDER summary rows and rows whose CCN is not in the lookup.
 */
export function transformPufRows(
  rows: Record<string, string>[],
  lookup: Map<string, string>,
): PufPaymentHistoryRow[] {
  const result: PufPaymentHistoryRow[] = [];
  for (const row of rows) {
    if (row.SMRY_CTGRY !== "PROVIDER") continue;
    const ccn = row.PRVDR_ID?.trim() ?? "";
    const providerId = lookup.get(ccn);
    if (!providerId) continue;
    result.push({
      provider_id: providerId,
      fiscal_year: parseInt(row.YEAR ?? "0", 10),
      medicare_payments: parseAmount(row.TOT_MDCR_PYMT_AMT),
      total_charges: parseAmount(row.TOT_CHRG_AMT),
      total_days: parseAmount(row.TOT_SRVC_DAYS),
      total_patients: parseAmount(row.BENE_DSTNCT_CNT),
      data_source: "utilization_puf",
    });
  }
  return result;
}

// ─── Provider Update Builder ───────────────────────────────────────────────

/**
 * Build provider update records from PUF rows for providers that have no
 * existing payment_data_source (i.e. no HCRIS data).
 *
 * When a provider has rows from multiple PUF datasets, the highest fiscal_year
 * wins. Skips providers whose medicare_payments is null.
 *
 * @param rows             All PufPaymentHistoryRow records across all datasets.
 * @param currentDataSources Map<provider_id, payment_data_source | null>
 *                           from the providers table.
 */
export function buildPufProviderUpdates(
  rows: PufPaymentHistoryRow[],
  currentDataSources: Map<string, string | null>,
): PufProviderUpdate[] {
  // Pre-filter: skip providers already sourced from HCRIS or elsewhere.
  // The DB-side .is("payment_data_source", null) guard is the authoritative
  // correctness check — this is an optimization to skip no-op updates.
  const latestByProvider = new Map<string, PufPaymentHistoryRow>();
  for (const row of rows) {
    const existingSource = currentDataSources.get(row.provider_id);
    if (existingSource !== null && existingSource !== undefined) continue;
    const current = latestByProvider.get(row.provider_id);
    if (!current || row.fiscal_year > current.fiscal_year) {
      latestByProvider.set(row.provider_id, row);
    }
  }

  const updates: PufProviderUpdate[] = [];
  for (const row of latestByProvider.values()) {
    if (row.medicare_payments === null) continue;
    updates.push({
      provider_id: row.provider_id,
      annual_medicare_payments: row.medicare_payments,
      payment_data_year: row.fiscal_year,
      payment_data_source: "utilization_puf",
      charge_to_payment_ratio: computeChargeToPaymentRatio(
        row.total_charges,
        row.medicare_payments,
      ),
    });
  }
  return updates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/lib/__tests__/puf.test.ts
```

Expected: All 17 tests PASS

- [ ] **Step 5: Run full suite to verify no regressions**

```bash
npx vitest run
```

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/puf.ts scripts/lib/__tests__/puf.test.ts
git commit -m "feat: add puf.ts pure functions and tests (PUB-8)"
```

---

## Chunk 2: I/O functions + orchestrator

### Task 2: I/O functions in `puf.ts` and the ingest orchestrator

**Files:**

- Modify: `scripts/lib/puf.ts` (append I/O functions)
- Create: `scripts/ingest-puf.ts`

**Context:**

- `resolveProviders(ccns: string[]): Promise<Map<string, string>>` is in `scripts/lib/hcris.ts`. It resolves CCNs to provider UUIDs in chunks of 1000. Pass deduplicated CCNs.
- `supabaseAdmin` is imported from `scripts/lib/supabase-admin.ts`.
- The PUF CSVs are plain text CSVs. Stream the response body through Node.js `readline` line by line (same pattern as `parseHcrisFile()` in `hcris.ts`). Split each line on `,`. First line is the header. Provider names do not appear in the numeric/code columns we use, so plain comma splitting is correct.
- **Critical:** `upsertPufPaymentHistory` MUST use `ignoreDuplicates: true` in the Supabase upsert. This maps to `ON CONFLICT DO NOTHING` and preserves existing HCRIS rows. Do NOT model this on `upsertPaymentHistory()` from `hcris.ts`, which uses `DO UPDATE` (overwrites).
- **Critical:** `updateProvidersFromPuf` MUST include `.is("payment_data_source", null)` on every update call. This is the primary correctness guard ensuring HCRIS providers are never overwritten.
- The orchestrator queries each provider's current `payment_data_source` in chunks of 1000 to build the `currentDataSources` map passed to `buildPufProviderUpdates`.

**PUF URLs (2023 data, update annually):**

```
SNF:     https://data.cms.gov/sites/default/files/2025-08/b646c0b9-5fe0-475c-8820-007680020fdc/RY_2025_RY_25_PAC_PUF_SNF_2023_main_final_unformatted.csv
HHA:     https://data.cms.gov/sites/default/files/2025-08/1d04af0f-9173-47b0-b5f8-26df7722247c/RY_2025_RY_25_PAC_PUF_HH_2023_main_final_unformatted.csv
Hospice: https://data.cms.gov/sites/default/files/2025-08/7c92ef92-85ff-4f2a-a1a6-b1f4f25210e4/RY_2025_RY_25_PAC_PUF_HOS_2023_main_final_unformatted.csv
```

- [ ] **Step 1: Append I/O functions to `puf.ts`**

Update the import at the top of `puf.ts` to also import `resolveProviders`, and add readline imports for CSV streaming:

```typescript
// Replace the existing import line at the top of puf.ts:
import { createInterface } from "readline";
import { Readable } from "stream";
import { computeChargeToPaymentRatio, resolveProviders } from "./hcris";
```

Add a lazy supabaseAdmin getter below the imports (same pattern as `hcris.ts` — avoids throwing at module load time in test environments where env vars are absent, which would break `npx vitest run`):

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

let _supabaseAdmin: SupabaseClient<Database> | undefined;
async function getSupabaseAdmin(): Promise<SupabaseClient<Database>> {
  if (!_supabaseAdmin) {
    const mod = await import("./supabase-admin");
    _supabaseAdmin = mod.supabaseAdmin;
  }
  return _supabaseAdmin;
}
```

Then add the I/O functions at the bottom of `puf.ts`:

**Note:** `updated_at` is intentionally omitted from the provider update payload — the `update_updated_at` trigger fires automatically on every UPDATE, so setting it explicitly is redundant.

```typescript
// ─── CSV Fetching ──────────────────────────────────────────────────────────

/**
 * Fetch a PUF CSV from a URL and parse it into row objects.
 * Streams the response body through readline line by line (matches
 * the parseHcrisFile() pattern in hcris.ts).
 * Returns all rows — caller filters by SMRY_CTGRY.
 */
export async function fetchAndParsePufCsv(
  url: string,
): Promise<Record<string, string>[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch PUF CSV from ${url}: ${response.status} ${response.statusText}`,
    );
  }
  if (!response.body) throw new Error(`No response body from ${url}`);

  const nodeStream = Readable.fromWeb(
    response.body as import("stream/web").ReadableStream,
  );
  const rl = createInterface({ input: nodeStream, crlfDelay: Infinity });

  let headers: string[] = [];
  const rows: Record<string, string>[] = [];
  let isFirst = true;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isFirst) {
      headers = trimmed.split(",").map((h) => h.trim());
      isFirst = false;
      continue;
    }
    const cols = trimmed.split(",");
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cols[j] ?? "").trim();
    }
    rows.push(row);
  }

  return rows;
}

// ─── Supabase Helpers ──────────────────────────────────────────────────────

const BATCH_SIZE = 500;
const CONCURRENT = 50;

/**
 * Insert PUF payment_history rows in batches of 500.
 * Uses ignoreDuplicates: true (ON CONFLICT DO NOTHING) so existing HCRIS
 * rows are never overwritten.
 *
 * DO NOT change to the default upsert behavior — that would overwrite HCRIS.
 */
export async function upsertPufPaymentHistory(
  rows: PufPaymentHistoryRow[],
): Promise<number> {
  const supabaseAdmin = await getSupabaseAdmin();
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabaseAdmin
      .from("payment_history")
      .upsert(batch, {
        onConflict: "provider_id,fiscal_year",
        ignoreDuplicates: true, // DO NOTHING — preserves HCRIS rows
        count: "exact",
      });
    if (error) throw new Error(`PUF upsert failed: ${error.message}`);
    total += count ?? 0;
    console.log(
      `  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${count ?? 0} rows`,
    );
  }
  return total;
}

/**
 * Update providers.annual_medicare_payments (and related fields) from PUF data.
 * The .is("payment_data_source", null) guard is the primary correctness check:
 * providers already sourced from HCRIS are never updated. DO NOT remove it.
 */
export async function updateProvidersFromPuf(
  updates: PufProviderUpdate[],
): Promise<number> {
  const supabaseAdmin = await getSupabaseAdmin();
  let total = 0;
  for (let i = 0; i < updates.length; i += CONCURRENT) {
    const batch = updates.slice(i, i + CONCURRENT);
    const counts = await Promise.all(
      batch.map(async (u) => {
        const { error, count } = await supabaseAdmin
          .from("providers")
          .update(
            {
              annual_medicare_payments: u.annual_medicare_payments,
              payment_data_year: u.payment_data_year,
              payment_data_source: u.payment_data_source,
              charge_to_payment_ratio: u.charge_to_payment_ratio,
            },
            { count: "exact" },
          )
          .eq("id", u.provider_id)
          .is("payment_data_source", null); // primary guard — DO NOT remove
        if (error) throw new Error(`Provider update failed: ${error.message}`);
        return count ?? 0;
      }),
    );
    total += counts.reduce((sum, c) => sum + c, 0);
  }
  return total;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Create `ingest-puf.ts`**

```typescript
// scripts/ingest-puf.ts
import { resolveProviders } from "./lib/hcris";
import {
  fetchAndParsePufCsv,
  transformPufRows,
  upsertPufPaymentHistory,
  buildPufProviderUpdates,
  updateProvidersFromPuf,
} from "./lib/puf";

// Update these URLs annually when CMS publishes new PUF data.
// Find updated URLs at: https://data.cms.gov (search "Post-Acute Care Utilization")
const PUF_URLS = {
  snf: "https://data.cms.gov/sites/default/files/2025-08/b646c0b9-5fe0-475c-8820-007680020fdc/RY_2025_RY_25_PAC_PUF_SNF_2023_main_final_unformatted.csv",
  hha: "https://data.cms.gov/sites/default/files/2025-08/1d04af0f-9173-47b0-b5f8-26df7722247c/RY_2025_RY_25_PAC_PUF_HH_2023_main_final_unformatted.csv",
  hospice:
    "https://data.cms.gov/sites/default/files/2025-08/7c92ef92-85ff-4f2a-a1a6-b1f4f25210e4/RY_2025_RY_25_PAC_PUF_HOS_2023_main_final_unformatted.csv",
};

const CHUNK_SIZE = 1000;

export async function main() {
  const { supabaseAdmin } = await import("./lib/supabase-admin");

  // ── Step 1: Fetch and parse all three CSVs ──────────────────────────────
  console.log("Fetching SNF PUF...");
  const snfRaw = await fetchAndParsePufCsv(PUF_URLS.snf);
  console.log(`  ${snfRaw.length} total rows (including summaries)`);

  console.log("Fetching HHA PUF...");
  const hhaRaw = await fetchAndParsePufCsv(PUF_URLS.hha);
  console.log(`  ${hhaRaw.length} total rows`);

  console.log("Fetching Hospice PUF...");
  const hospiceRaw = await fetchAndParsePufCsv(PUF_URLS.hospice);
  console.log(`  ${hospiceRaw.length} total rows`);

  // ── Step 2: Collect and deduplicate CCNs, resolve to provider UUIDs ─────
  const allCcns = [
    ...snfRaw
      .filter((r) => r.SMRY_CTGRY === "PROVIDER")
      .map((r) => r.PRVDR_ID?.trim()),
    ...hhaRaw
      .filter((r) => r.SMRY_CTGRY === "PROVIDER")
      .map((r) => r.PRVDR_ID?.trim()),
    ...hospiceRaw
      .filter((r) => r.SMRY_CTGRY === "PROVIDER")
      .map((r) => r.PRVDR_ID?.trim()),
  ].filter(Boolean) as string[];

  const uniqueCcns = [...new Set(allCcns)];
  console.log(
    `\nResolving ${uniqueCcns.length} unique CCNs to provider UUIDs...`,
  );
  const lookup = await resolveProviders(uniqueCcns);
  console.log(`  Matched ${lookup.size} providers`);

  // ── Step 3: Transform each dataset ──────────────────────────────────────
  const snfRows = transformPufRows(snfRaw, lookup);
  const hhaRows = transformPufRows(hhaRaw, lookup);
  const hospiceRows = transformPufRows(hospiceRaw, lookup);

  console.log(`\nSNF:     ${snfRows.length} provider rows`);
  console.log(`HHA:     ${hhaRows.length} provider rows`);
  console.log(`Hospice: ${hospiceRows.length} provider rows`);

  // ── Step 4: Upsert each dataset (DO NOTHING on conflict with HCRIS) ─────
  console.log("\nUpserting SNF payment history...");
  const snfInserted = await upsertPufPaymentHistory(snfRows);

  console.log("Upserting HHA payment history...");
  const hhaInserted = await upsertPufPaymentHistory(hhaRows);

  console.log("Upserting Hospice payment history...");
  const hospiceInserted = await upsertPufPaymentHistory(hospiceRows);

  // ── Step 5: Build provider updates ──────────────────────────────────────
  const allRows = [...snfRows, ...hhaRows, ...hospiceRows];
  const allProviderIds = [...new Set(allRows.map((r) => r.provider_id))];

  // Query current payment_data_source for each provider in chunks of 1000.
  const currentDataSources = new Map<string, string | null>();
  for (let i = 0; i < allProviderIds.length; i += CHUNK_SIZE) {
    const chunk = allProviderIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("id, payment_data_source")
      .in("id", chunk);
    if (error) throw new Error(`Failed to query providers: ${error.message}`);
    for (const p of data ?? []) {
      currentDataSources.set(p.id, p.payment_data_source ?? null);
    }
  }

  const updates = buildPufProviderUpdates(allRows, currentDataSources);

  // ── Step 6: Update providers (DB guard: payment_data_source IS NULL) ────
  console.log(
    `\nUpdating ${updates.length} providers with PUF payment data...`,
  );
  const providersUpdated = await updateProvidersFromPuf(updates);

  // ── Step 7: Summary ──────────────────────────────────────────────────────
  const totalAttempted = snfRows.length + hhaRows.length + hospiceRows.length;
  const totalInserted = snfInserted + hhaInserted + hospiceInserted;
  const skipped = totalAttempted - totalInserted;

  console.log("\n--- PUF Ingestion Summary ---");
  console.log(
    `SNF:     ${snfRows.length} rows attempted, ${snfInserted} inserted`,
  );
  console.log(
    `HHA:     ${hhaRows.length} rows attempted, ${hhaInserted} inserted`,
  );
  console.log(
    `Hospice: ${hospiceRows.length} rows attempted, ${hospiceInserted} inserted`,
  );
  console.log(
    `Total:   ${totalAttempted} attempted, ${totalInserted} inserted, ${skipped} skipped (HCRIS conflicts)`,
  );
  console.log(`Providers updated: ${providersUpdated}`);
  console.log("Ingestion complete.");
}

const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npx vitest run
```

Expected: All tests pass (including the 17 new puf.test.ts tests)

- [ ] **Step 6: Run the ingest script against production**

```bash
set -a && source .env.local && set +a && npx tsx scripts/ingest-puf.ts
```

Expected output (approximate):

```
Fetching SNF PUF...
  ~14500 total rows (including summaries)
Fetching HHA PUF...
  ~8700 total rows
Fetching Hospice PUF...
  ~6000 total rows

Resolving ~28000 unique CCNs to provider UUIDs...
  Matched ~26000 providers

SNF:     ~14161 provider rows
HHA:     ~8466 provider rows
Hospice: ~5771 provider rows

Upserting SNF payment history...
  [batch logs]
Upserting HHA payment history...
  [batch logs]
Upserting Hospice payment history...
  [batch logs]

Updating N providers with PUF payment data...

--- PUF Ingestion Summary ---
SNF:     ~14161 rows attempted, N inserted
HHA:     ~8466 rows attempted, N inserted
Hospice: ~5771 rows attempted, N inserted
Total:   ~28398 attempted, N inserted, M skipped (HCRIS conflicts)
Providers updated: N
Ingestion complete.
```

- [ ] **Step 7: Run format check**

```bash
npx prettier --check .
```

If it reports issues, fix with:

```bash
npx prettier --write scripts/lib/puf.ts scripts/ingest-puf.ts
```

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/puf.ts scripts/ingest-puf.ts
git commit -m "feat: add PUF ingestion I/O and orchestrator (PUB-8)"
```

---

## Verification queries

After the ingest completes, run these against the production DB to verify correctness:

```sql
-- Count payment_history rows by data_source
SELECT data_source, COUNT(*) FROM payment_history GROUP BY data_source;
-- Expected: rows for "hcris" and "utilization_puf"

-- Verify no provider has both HCRIS and PUF rows for the same year
-- (unique index guarantees this, but sanity check)
SELECT provider_id, fiscal_year, COUNT(DISTINCT data_source)
FROM payment_history
GROUP BY provider_id, fiscal_year
HAVING COUNT(DISTINCT data_source) > 1;
-- Expected: 0 rows

-- Count providers updated with PUF as payment source
SELECT payment_data_source, COUNT(*) FROM providers GROUP BY payment_data_source;
-- Expected: "hcris" count unchanged; "utilization_puf" shows new count
```
