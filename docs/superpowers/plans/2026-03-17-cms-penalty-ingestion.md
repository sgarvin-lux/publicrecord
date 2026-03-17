# CMS Penalty Data Ingestion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest CMS nursing home penalty data into the `penalties` table via a standalone script run daily by GitHub Actions.

**Architecture:** Standalone TypeScript script (`scripts/ingest-penalties.ts`) fetches all records from the CMS Provider Data JSON API using a reusable paginated client (`scripts/lib/cms-api.ts`), resolves CMS IDs to provider UUIDs, transforms records, and batch-upserts into Supabase using a service-role admin client (`scripts/lib/supabase-admin.ts`).

**Tech Stack:** TypeScript, tsx, Vitest, @supabase/supabase-js, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-17-cms-penalty-ingestion-design.md`

---

## File Map

| File                                                                 | Action | Responsibility                               |
| -------------------------------------------------------------------- | ------ | -------------------------------------------- |
| `scripts/lib/cms-api.ts`                                             | Create | Reusable paginated CMS API client with retry |
| `scripts/lib/supabase-admin.ts`                                      | Create | Service-role Supabase client for scripts     |
| `scripts/ingest-penalties.ts`                                        | Create | Main ingestion orchestrator                  |
| `scripts/lib/__tests__/cms-api.test.ts`                              | Create | Unit tests for CMS API client                |
| `scripts/lib/__tests__/transform-penalties.test.ts`                  | Create | Unit tests for penalty transform logic       |
| `scripts/__tests__/ingest-penalties.test.ts`                         | Create | Integration test for full pipeline           |
| `supabase/migrations/20260317000009_penalties_unique_constraint.sql` | Create | Unique constraint for upserts                |
| `.github/workflows/ingest-penalties.yml`                             | Create | Daily cron + manual dispatch                 |
| `package.json`                                                       | Modify | Add vitest, tsx devDeps; add test script     |
| `vitest.config.ts`                                                   | Create | Vitest configuration                         |

---

## Chunk 1: Foundation (test infra, migration, shared libs)

### Task 1: Add Vitest and tsx

**Files:**

- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest and tsx**

```bash
npm install -D vitest tsx
```

- [ ] **Step 2: Add test script to package.json**

Add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    include: ["scripts/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 4: Run vitest to verify setup**

Run: `npx vitest run`
Expected: "No test files found" (clean exit, no errors)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest and tsx for script testing"
```

---

### Task 2: Database migration — penalties unique constraint

**Files:**

- Create: `supabase/migrations/20260317000009_penalties_unique_constraint.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Make penalty_type and amount NOT NULL to support unique constraint
-- penalty_type is always present in CMS data; amount defaults to 0 for Payment Denials
ALTER TABLE penalties ALTER COLUMN penalty_type SET NOT NULL;
ALTER TABLE penalties ALTER COLUMN amount SET NOT NULL;
ALTER TABLE penalties ALTER COLUMN amount SET DEFAULT 0;

-- Add unique constraint for penalty upserts
ALTER TABLE penalties
  ADD CONSTRAINT uq_penalties_natural_key
  UNIQUE (provider_id, penalty_date, penalty_type, amount);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260317000009_penalties_unique_constraint.sql
git commit -m "feat: add unique constraint on penalties for upsert support"
```

---

### Task 3: Supabase admin client

**Files:**

- Create: `scripts/lib/supabase-admin.ts`

- [ ] **Step 1: Create the admin client**

```ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables",
  );
}

export const supabaseAdmin = createClient<Database>(
  supabaseUrl,
  supabaseServiceRoleKey,
);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/lib/supabase-admin.ts
git commit -m "feat: add shared Supabase admin client for ingestion scripts"
```

---

### Task 4: CMS API client — tests first

**Files:**

- Create: `scripts/lib/cms-api.ts`
- Create: `scripts/lib/__tests__/cms-api.test.ts`

- [ ] **Step 1: Write failing tests for fetchAllPages**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAllPages } from "../cms-api";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchAllPages", () => {
  it("fetches a single page when count <= pageSize", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { id: "1", name: "Record 1" },
          { id: "2", name: "Record 2" },
        ],
        count: 2,
      }),
    });

    const results = await fetchAllPages("test-dataset", 1000);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: "1", name: "Record 1" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("test-dataset"),
      expect.any(Object),
    );
  });

  it("paginates across multiple pages", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ id: "1" }, { id: "2" }],
          count: 3,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ id: "3" }],
          count: 3,
        }),
      });

    const results = await fetchAllPages("test-dataset", 2);

    expect(results).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on failure and succeeds", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ id: "1" }],
          count: 1,
        }),
      });

    const results = await fetchAllPages("test-dataset", 1000);

    expect(results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after max retries exhausted", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    await expect(fetchAllPages("test-dataset", 1000)).rejects.toThrow(
      "Network error",
    );
    // 1 initial + 3 retries = 4 calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("throws on non-ok HTTP response after retries", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(fetchAllPages("test-dataset", 1000)).rejects.toThrow("500");
    // 1 initial + 3 retries = 4 calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/lib/__tests__/cms-api.test.ts`
Expected: FAIL — cannot resolve `../cms-api`

- [ ] **Step 3: Implement fetchAllPages**

```ts
const CMS_API_BASE = "https://data.cms.gov/provider-data/api/1/datastore/query";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

async function fetchPage(
  datasetId: string,
  offset: number,
  limit: number,
): Promise<{ results: Record<string, string>[]; count: number }> {
  const url = `${CMS_API_BASE}/${datasetId}/0?offset=${offset}&limit=${limit}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          `CMS API returned ${response.status} ${response.statusText}`,
        );
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        console.warn(
          `CMS API request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${lastError.message}`,
        );
      }
    }
  }

  throw lastError;
}

export async function fetchAllPages(
  datasetId: string,
  pageSize = 1000,
): Promise<Record<string, string>[]> {
  const allResults: Record<string, string>[] = [];
  let offset = 0;

  const firstPage = await fetchPage(datasetId, 0, pageSize);
  allResults.push(...firstPage.results);
  const total = firstPage.count;

  console.log(`CMS dataset ${datasetId}: ${total} total records`);

  offset = pageSize;
  while (offset < total) {
    const page = await fetchPage(datasetId, offset, pageSize);
    allResults.push(...page.results);
    offset += pageSize;
  }

  console.log(`Fetched ${allResults.length} records in total`);
  return allResults;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/lib/__tests__/cms-api.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/cms-api.ts scripts/lib/__tests__/cms-api.test.ts
git commit -m "feat: add reusable CMS API client with pagination and retry"
```

---

## Chunk 2: Transform logic and main script

### Task 5: Penalty transform — tests first

**Files:**

- Create: `scripts/lib/transform-penalties.ts`
- Create: `scripts/lib/__tests__/transform-penalties.test.ts`

- [ ] **Step 1: Write failing tests for transform functions**

```ts
import { describe, it, expect } from "vitest";
import {
  parseCmsDate,
  parseAmount,
  composeDescription,
  transformPenaltyRecord,
} from "../transform-penalties";

describe("parseCmsDate", () => {
  it("parses MM/DD/YYYY to YYYY-MM-DD", () => {
    expect(parseCmsDate("01/15/2025")).toBe("2025-01-15");
  });

  it("returns null for empty string", () => {
    expect(parseCmsDate("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseCmsDate(undefined)).toBeNull();
  });
});

describe("parseAmount", () => {
  it("parses a plain number string", () => {
    expect(parseAmount("12500")).toBe(12500);
  });

  it("strips dollar sign and commas", () => {
    expect(parseAmount("$12,500.00")).toBe(12500);
  });

  it("returns 0 for empty string", () => {
    expect(parseAmount("")).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(parseAmount(undefined)).toBe(0);
  });
});

describe("composeDescription", () => {
  it("composes fine description with formatted amount", () => {
    expect(
      composeDescription({
        penalty_type: "Fine",
        fine_amount: "12500",
      }),
    ).toBe("Civil money penalty: $12,500");
  });

  it("composes payment denial with days and start date", () => {
    expect(
      composeDescription({
        penalty_type: "Payment Denial",
        payment_denial_length_in_days: "30",
        payment_denial_start_date: "01/15/2025",
      }),
    ).toBe("Payment denial: 30 days starting 2025-01-15");
  });

  it("falls back for payment denial without details", () => {
    expect(
      composeDescription({
        penalty_type: "Payment Denial",
      }),
    ).toBe("Payment denial");
  });

  it("handles unknown penalty type", () => {
    expect(
      composeDescription({
        penalty_type: "State Monitor",
      }),
    ).toBe("State Monitor");
  });
});

describe("transformPenaltyRecord", () => {
  const providerMap = new Map([["015001", "uuid-abc-123"]]);

  it("transforms a Fine record correctly", () => {
    const raw = {
      cms_certification_number_ccn: "015001",
      penalty_date: "03/15/2025",
      penalty_type: "Fine",
      fine_amount: "5000",
      payment_denial_start_date: "",
      payment_denial_length_in_days: "",
    };

    const result = transformPenaltyRecord(raw, providerMap);

    expect(result).toEqual({
      provider_id: "uuid-abc-123",
      penalty_date: "2025-03-15",
      penalty_type: "Fine",
      amount: 5000,
      description: "Civil money penalty: $5,000",
    });
  });

  it("transforms a Payment Denial with amount defaulted to 0", () => {
    const raw = {
      cms_certification_number_ccn: "015001",
      penalty_date: "03/15/2025",
      penalty_type: "Payment Denial",
      fine_amount: "",
      payment_denial_start_date: "03/20/2025",
      payment_denial_length_in_days: "15",
    };

    const result = transformPenaltyRecord(raw, providerMap);

    expect(result).toEqual({
      provider_id: "uuid-abc-123",
      penalty_date: "2025-03-15",
      penalty_type: "Payment Denial",
      amount: 0,
      description: "Payment denial: 15 days starting 2025-03-20",
    });
  });

  it("returns null for unknown CMS ID", () => {
    const raw = {
      cms_certification_number_ccn: "999999",
      penalty_date: "03/15/2025",
      penalty_type: "Fine",
      fine_amount: "1000",
    };

    const result = transformPenaltyRecord(raw, providerMap);
    expect(result).toBeNull();
  });

  it("returns null for missing penalty_date", () => {
    const raw = {
      cms_certification_number_ccn: "015001",
      penalty_date: "",
      penalty_type: "Fine",
      fine_amount: "1000",
    };

    const result = transformPenaltyRecord(raw, providerMap);
    expect(result).toBeNull();
  });

  it("returns null for missing penalty_type", () => {
    const raw = {
      cms_certification_number_ccn: "015001",
      penalty_date: "03/15/2025",
      penalty_type: "",
      fine_amount: "1000",
    };

    const result = transformPenaltyRecord(raw, providerMap);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/lib/__tests__/transform-penalties.test.ts`
Expected: FAIL — cannot resolve `../transform-penalties`

- [ ] **Step 3: Implement transform functions**

```ts
export function parseCmsDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseAmount(amountStr: string | undefined): number {
  if (!amountStr) return 0;
  const cleaned = amountStr.replace(/[$,]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function formatUsd(amount: number): string {
  const rounded = Math.round(amount);
  const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "$" + formatted;
}

export function composeDescription(
  raw: Record<string, string | undefined>,
): string {
  const type = raw.penalty_type ?? "";

  if (type === "Fine") {
    const amount = parseAmount(raw.fine_amount);
    return `Civil money penalty: ${formatUsd(amount)}`;
  }

  if (type === "Payment Denial") {
    const days = raw.payment_denial_length_in_days;
    const startDate = parseCmsDate(raw.payment_denial_start_date);

    if (days && startDate) {
      return `Payment denial: ${days} days starting ${startDate}`;
    }
    return "Payment denial";
  }

  return type;
}

export interface PenaltyRow {
  provider_id: string;
  penalty_date: string;
  penalty_type: string;
  amount: number;
  description: string;
}

export function transformPenaltyRecord(
  raw: Record<string, string | undefined>,
  providerMap: Map<string, string>,
): PenaltyRow | null {
  const cmsId = raw.cms_certification_number_ccn;
  const penaltyDate = parseCmsDate(raw.penalty_date);
  const penaltyType = raw.penalty_type;

  if (!cmsId || !penaltyDate || !penaltyType) return null;

  const providerId = providerMap.get(cmsId);
  if (!providerId) return null;

  const isFine = penaltyType === "Fine";
  const amount = isFine ? parseAmount(raw.fine_amount) : 0;
  const description = composeDescription(raw);

  return {
    provider_id: providerId,
    penalty_date: penaltyDate,
    penalty_type: penaltyType,
    amount,
    description,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/lib/__tests__/transform-penalties.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/transform-penalties.ts scripts/lib/__tests__/transform-penalties.test.ts
git commit -m "feat: add penalty record transform with date, amount, and description logic"
```

---

### Task 6: Main ingestion script

**Files:**

- Create: `scripts/ingest-penalties.ts`

- [ ] **Step 1: Write the main ingestion script**

```ts
import { fetchAllPages } from "./lib/cms-api";
import { supabaseAdmin } from "./lib/supabase-admin";
import {
  transformPenaltyRecord,
  type PenaltyRow,
} from "./lib/transform-penalties";

const DATASET_ID = "g6vv-u9sr";
const UPSERT_BATCH_SIZE = 500;

async function resolveProviders(
  cmsIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // Query in chunks to avoid overly large IN clauses
  const chunkSize = 1000;
  for (let i = 0; i < cmsIds.length; i += chunkSize) {
    const chunk = cmsIds.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("id, cms_id")
      .in("cms_id", chunk);

    if (error) {
      throw new Error(`Failed to resolve providers: ${error.message}`);
    }

    for (const row of data ?? []) {
      map.set(row.cms_id, row.id);
    }
  }

  return map;
}

async function upsertBatch(batch: PenaltyRow[]): Promise<number> {
  const { error, count } = await supabaseAdmin.from("penalties").upsert(batch, {
    onConflict: "provider_id,penalty_date,penalty_type,amount",
    count: "exact",
  });

  if (error) {
    console.error(`Upsert batch failed: ${error.message}`);
    return 0;
  }

  return count ?? batch.length;
}

export async function main() {
  console.log("Starting CMS penalty data ingestion...");

  // 1. Fetch all records from CMS
  const rawRecords = await fetchAllPages(DATASET_ID);

  // 2. Resolve CMS IDs to provider UUIDs
  const uniqueCmsIds = [
    ...new Set(
      rawRecords
        .map((r) => r.cms_certification_number_ccn)
        .filter(Boolean) as string[],
    ),
  ];
  console.log(`Found ${uniqueCmsIds.length} unique CMS provider IDs`);

  const providerMap = await resolveProviders(uniqueCmsIds);
  console.log(`Resolved ${providerMap.size} providers`);

  const unmatchedCount = uniqueCmsIds.length - providerMap.size;
  if (unmatchedCount > 0) {
    const unmatched = uniqueCmsIds.filter((id) => !providerMap.has(id));
    console.warn(
      `${unmatchedCount} CMS IDs not found in providers table:`,
      unmatched.slice(0, 10).join(", "),
      unmatchedCount > 10 ? `... and ${unmatchedCount - 10} more` : "",
    );
  }

  // 3. Transform records
  const transformed: PenaltyRow[] = [];
  let skippedCount = 0;

  for (const raw of rawRecords) {
    const row = transformPenaltyRecord(raw, providerMap);
    if (row) {
      transformed.push(row);
    } else {
      skippedCount++;
    }
  }

  console.log(
    `Transformed ${transformed.length} records (${skippedCount} skipped)`,
  );

  if (transformed.length === 0) {
    console.error("No records to upsert — exiting with failure");
    process.exit(1);
  }

  // 4. Upsert in batches
  let totalUpserted = 0;
  for (let i = 0; i < transformed.length; i += UPSERT_BATCH_SIZE) {
    const batch = transformed.slice(i, i + UPSERT_BATCH_SIZE);
    const count = await upsertBatch(batch);
    totalUpserted += count;
    console.log(
      `Upserted batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}: ${count} records`,
    );
  }

  // 5. Report
  console.log("\n--- Ingestion Summary ---");
  console.log(`Total fetched:    ${rawRecords.length}`);
  console.log(`Providers matched: ${providerMap.size}/${uniqueCmsIds.length}`);
  console.log(`Records skipped:  ${skippedCount}`);
  console.log(`Records upserted: ${totalUpserted}`);

  if (totalUpserted === 0) {
    console.error("Zero records upserted — exiting with failure");
    process.exit(1);
  }

  console.log("Ingestion complete.");
}

main().catch((error) => {
  console.error("Ingestion failed:", error);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script compiles**

Run: `npx tsc --noEmit scripts/ingest-penalties.ts --esModuleInterop --moduleResolution bundler --module esnext --target ES2017 --strict --paths '{"@/*": ["./src/*"]}' --baseUrl .`

If tsc path resolution is complex, use: `npx tsx --eval "import './scripts/ingest-penalties'" 2>&1 | head -5`
Expected: Should fail on missing env vars, not on syntax/import errors. This confirms the code compiles correctly.

- [ ] **Step 3: Commit**

```bash
git add scripts/ingest-penalties.ts
git commit -m "feat: add main CMS penalty ingestion script"
```

---

## Chunk 3: Integration test, workflow, and cleanup

### Task 7: Integration test

**Files:**

- Create: `scripts/__tests__/ingest-penalties.test.ts`

This test verifies the full pipeline by importing and running `main()` with mocked dependencies, then asserting the correct upsert payloads reach Supabase.

Note: To make `main()` testable, refactor `scripts/ingest-penalties.ts` to export `main()` as a named export, and move the top-level `main().catch(...)` call behind an `if (import.meta.url === ...)` guard or into a separate entrypoint. The simplest approach: export `main` and keep the self-invoking call — in tests, the module mock for `supabase-admin` prevents real DB calls, and we mock `process.exit` to prevent the test runner from exiting.

- [ ] **Step 1: Write integration test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the CMS API client
vi.mock("../lib/cms-api", () => ({
  fetchAllPages: vi.fn(),
}));

// Mock the Supabase admin client
vi.mock("../lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { fetchAllPages } from "../lib/cms-api";
import { supabaseAdmin } from "../lib/supabase-admin";

const mockFetchAllPages = vi.mocked(fetchAllPages);
const mockFrom = vi.mocked(supabaseAdmin.from);

describe("ingest-penalties pipeline", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("fetches, transforms, and upserts CMS penalty records end-to-end", async () => {
    // Mock CMS API response
    mockFetchAllPages.mockResolvedValue([
      {
        cms_certification_number_ccn: "015001",
        penalty_date: "03/15/2025",
        penalty_type: "Fine",
        fine_amount: "5000",
        payment_denial_start_date: "",
        payment_denial_length_in_days: "",
      },
      {
        cms_certification_number_ccn: "015001",
        penalty_date: "04/01/2025",
        penalty_type: "Payment Denial",
        fine_amount: "",
        payment_denial_start_date: "04/05/2025",
        payment_denial_length_in_days: "30",
      },
      {
        cms_certification_number_ccn: "999999",
        penalty_date: "05/01/2025",
        penalty_type: "Fine",
        fine_amount: "1000",
        payment_denial_start_date: "",
        payment_denial_length_in_days: "",
      },
    ]);

    // Mock provider resolution
    const mockIn = vi.fn().mockResolvedValue({
      data: [{ id: "uuid-abc-123", cms_id: "015001" }],
      error: null,
    });
    const mockSelect = vi.fn().mockReturnValue({ in: mockIn });

    // Capture upsert calls to verify payloads
    const upsertCalls: unknown[] = [];
    const mockUpsert = vi.fn().mockImplementation((batch, _opts) => {
      upsertCalls.push(batch);
      return Promise.resolve({ error: null, count: batch.length });
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "providers") return { select: mockSelect } as any;
      if (table === "penalties") return { upsert: mockUpsert } as any;
      throw new Error(`Unexpected table: ${table}`);
    });

    // Import and run main
    const { main } = await import("../ingest-penalties");
    await main();

    // Verify CMS API was called with correct dataset
    expect(mockFetchAllPages).toHaveBeenCalledWith("g6vv-u9sr");

    // Verify provider lookup was called
    expect(mockSelect).toHaveBeenCalledWith("id, cms_id");

    // Verify upsert was called with transformed records
    // Record with CMS ID 999999 should be skipped (not in provider map)
    const allUpserted = upsertCalls.flat();
    expect(allUpserted).toHaveLength(2);
    expect(allUpserted).toContainEqual({
      provider_id: "uuid-abc-123",
      penalty_date: "2025-03-15",
      penalty_type: "Fine",
      amount: 5000,
      description: "Civil money penalty: $5,000",
    });
    expect(allUpserted).toContainEqual({
      provider_id: "uuid-abc-123",
      penalty_date: "2025-04-01",
      penalty_type: "Payment Denial",
      amount: 0,
      description: "Payment denial: 30 days starting 2025-04-05",
    });
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/ingest-penalties.test.ts
git commit -m "test: add integration test for penalty ingestion pipeline"
```

---

### Task 8: GitHub Actions workflow

**Files:**

- Create: `.github/workflows/ingest-penalties.yml`

- [ ] **Step 1: Create workflow file**

```yaml
name: Ingest CMS Penalties

on:
  schedule:
    # Run daily at 3am UTC
    - cron: "0 3 * * *"
  workflow_dispatch:

jobs:
  ingest:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"

      - run: npm ci

      - name: Ingest penalty data
        run: npx tsx scripts/ingest-penalties.ts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ingest-penalties.yml
git commit -m "ci: add daily GitHub Actions workflow for penalty ingestion"
```

---

### Task 9: Lint, type-check, and final verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors (fix any that appear)

- [ ] **Step 3: Run type-check**

Run: `npm run type-check`
Expected: No errors (fix any that appear)

- [ ] **Step 4: Run formatter**

Run: `npm run format`
Then: `npm run format:check`
Expected: All files formatted

- [ ] **Step 5: Final commit if any formatting/lint fixes**

```bash
git add -A
git commit -m "chore: fix lint and formatting"
```
