# Operator Matching & Ownership Data Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest CMS nursing home ownership data (dataset `y2hd-n93e`) and link facilities under common operators via normalized entity-name matching.

**Architecture:** A single `ingest-ownership.ts` script runs five sequential phases: fetch raw CMS data, build provider lookup, full-replace teardown, batch-insert ownership rows, then group by normalized name and create/link operators. Transform helpers and name normalization live in `scripts/lib/transform-ownership.ts` for independent testability.

**Tech Stack:** TypeScript, Vitest (`npm test`), Supabase JS client, `tsx` for execution, GitHub Actions for scheduling.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `scripts/lib/transform-ownership.ts` | Create | `OwnershipRow` type, `normalizeEntityName()`, `transformOwnership()` |
| `scripts/lib/__tests__/transform-ownership.test.ts` | Create | Unit tests for normalizeEntityName and transformOwnership |
| `scripts/ingest-ownership.ts` | Create | Full pipeline orchestration (Phases 1–5) |
| `scripts/__tests__/ingest-ownership.test.ts` | Create | Integration tests for Phase 5 matching and zero-insert guard |
| `.github/workflows/ingest-ownership.yml` | Create | Monday 2am UTC schedule + manual dispatch |
| `.github/workflows/compute-risk-scores.yml` | Modify | Add `Ingest Ownership` to `workflow_run.workflows` list |

---

## Chunk 1: Transform Library

### Task 1: Discover CMS field names

**Files:** none — research step only

- [ ] **Step 1: Fetch one page of the CMS ownership dataset**

```bash
curl -s "https://data.cms.gov/provider-data/api/1/datastore/query/y2hd-n93e/0?offset=0&limit=2" | python3 -m json.tool
```

Expected: JSON with a `results` array. Each element is a record with string fields. Identify and record:
- The CCN/provider number field (e.g., `provnum`, `cms_certification_number_ccn`)
- The owner name field (e.g., `owner_name`, `ownname`)
- The owner type field (e.g., `owner_type`, `owntype`, `role_type`)
- The ownership percentage field (e.g., `ownership_percentage`, `ownpct`)
- The effective/association date field (e.g., `assoc_date_first`, `effective_date`)

**Write these down — you'll use them throughout Tasks 2–3.**

---

### Task 2: `normalizeEntityName()` — TDD

**Files:**
- Create: `scripts/lib/transform-ownership.ts`
- Create: `scripts/lib/__tests__/transform-ownership.test.ts`

- [ ] **Step 1: Create the test file**

`scripts/lib/__tests__/transform-ownership.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeEntityName } from "../transform-ownership";

describe("normalizeEntityName", () => {
  it("strips LLC suffix", () =>
    expect(normalizeEntityName("Sunrise Senior Living, LLC")).toBe("sunrise senior living"));

  it("strips Corp. suffix with trailing period", () =>
    expect(normalizeEntityName("GENESIS HEALTHCARE CORP.")).toBe("genesis healthcare"));

  it("strips Inc suffix", () =>
    expect(normalizeEntityName("ABC Management Inc")).toBe("abc management"));

  it("strips L.L.C. suffix", () =>
    expect(normalizeEntityName("ABC Health Services, L.L.C.")).toBe("abc health services"));

  it("strips L.L.C without trailing dot", () =>
    expect(normalizeEntityName("ABC Health Services, L.L.C")).toBe("abc health services"));

  it("strips Ltd suffix", () =>
    expect(normalizeEntityName("Smith Holdings Ltd")).toBe("smith holdings"));

  it("strips LP suffix", () =>
    expect(normalizeEntityName("Acme Partners LP")).toBe("acme partners"));

  it("strips LLP suffix", () =>
    expect(normalizeEntityName("Brown Associates LLP")).toBe("brown associates"));

  it("strips L.L.P. suffix", () =>
    expect(normalizeEntityName("Brown Associates L.L.P.")).toBe("brown associates"));

  it("strips L.P. suffix", () =>
    expect(normalizeEntityName("Acme Partners L.P.")).toBe("acme partners"));

  it("strips Limited suffix", () =>
    expect(normalizeEntityName("Smith Holdings Limited")).toBe("smith holdings"));

  it("strips Co suffix", () =>
    expect(normalizeEntityName("Acme Co")).toBe("acme"));

  it("strips Incorporated suffix", () =>
    expect(normalizeEntityName("Sunrise Care Incorporated")).toBe("sunrise care"));

  it("strips Corporation suffix", () =>
    expect(normalizeEntityName("National Health Corporation")).toBe("national health"));

  it("lowercases the result", () =>
    expect(normalizeEntityName("SENIOR CARE INC")).toBe("senior care"));

  it("collapses internal whitespace", () =>
    expect(normalizeEntityName("Acme   Health  Inc")).toBe("acme health"));

  it("trims leading and trailing whitespace", () =>
    expect(normalizeEntityName("  Acme Inc  ")).toBe("acme"));

  it("does not strip suffix words that appear mid-name", () =>
    expect(normalizeEntityName("Incorporated Care LLC")).toBe("incorporated care"));

  it("does not strip Co from mid-word (e.g., Costco)", () =>
    expect(normalizeEntityName("Costco Health LLC")).toBe("costco health"));

  it("returns empty string for empty input", () =>
    expect(normalizeEntityName("")).toBe(""));

  it("returns empty string for whitespace-only input", () =>
    expect(normalizeEntityName("   ")).toBe(""));

  it("handles already-clean names with no changes", () =>
    expect(normalizeEntityName("sunrise senior living")).toBe("sunrise senior living"));

  it("strips commas and periods from names", () =>
    expect(normalizeEntityName("Smith, John A.")).toBe("smith john a"));
});
```

- [ ] **Step 2: Run to verify all tests fail**

```bash
npx vitest run scripts/lib/__tests__/transform-ownership.test.ts
```
Expected: All fail with `Cannot find module '../transform-ownership'`

- [ ] **Step 3: Create `scripts/lib/transform-ownership.ts` with `normalizeEntityName`**

```typescript
export type CmsRecord = Record<string, string | undefined>;

export interface OwnershipRow {
  cms_id: string;         // intermediate — used for provider_id lookup, not persisted
  owner_name: string;
  owner_type: string | null;
  ownership_pct: number | null;
  effective_date: string | null; // ISO date string or null
}

// Longer forms must come before shorter to avoid partial matches (e.g., "incorporated" before "inc")
const SUFFIX_RE =
  /[\s,]+(l\.l\.c\.?|l\.l\.p\.?|l\.p\.?|incorporated|corporation|limited|llc|llp|corp|ltd|lp|inc|co)\.?\s*$/i;

/**
 * Normalizes an owner entity name for matching:
 * 1. Lowercase
 * 2. Strip legal entity suffixes (whole word at end), repeated until stable
 * 3. Strip punctuation (commas, periods, apostrophes)
 * 4. Collapse whitespace
 */
export function normalizeEntityName(name: string): string {
  if (!name.trim()) return "";

  let s = name.toLowerCase();

  // Repeat to handle stacked suffixes like "Inc., LLC"
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(SUFFIX_RE, "");
  }

  // Strip remaining punctuation
  s = s.replace(/[,.']/g, " ");

  return s.replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/lib/__tests__/transform-ownership.test.ts
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/transform-ownership.ts scripts/lib/__tests__/transform-ownership.test.ts
git commit -m "feat(PUB-11): add normalizeEntityName with tests"
```

---

### Task 3: `transformOwnership()` — TDD

**Files:**
- Modify: `scripts/lib/transform-ownership.ts`
- Modify: `scripts/lib/__tests__/transform-ownership.test.ts`

> **Before this task:** Replace the `<FIELD>` placeholders below with the actual CMS field names you found in Task 1.

- [ ] **Step 1: Add failing tests for `transformOwnership`**

Merge the new import into the existing import block at the **top** of `scripts/lib/__tests__/transform-ownership.test.ts` (do not append to the bottom — ES module imports must appear at the top of the file):

```typescript
import { describe, it, expect } from "vitest";
import { normalizeEntityName, transformOwnership } from "../transform-ownership";
```

Then append the following `describe` block to the bottom of the file (after the `normalizeEntityName` describe block):

```typescript
// !! Replace with actual field names from Task 1 discovery !!
const CCN_FIELD = "<CCN_FIELD>";
const OWNER_NAME_FIELD = "<OWNER_NAME_FIELD>";
const OWNER_TYPE_FIELD = "<OWNER_TYPE_FIELD>";
const OWNERSHIP_PCT_FIELD = "<OWNERSHIP_PCT_FIELD>";
const EFFECTIVE_DATE_FIELD = "<EFFECTIVE_DATE_FIELD>";

describe("transformOwnership", () => {
  const baseRecord: Record<string, string> = {
    [CCN_FIELD]: "015001",
    [OWNER_NAME_FIELD]: "Sunrise Senior Living, LLC",
    [OWNER_TYPE_FIELD]: "Organization",
    [OWNERSHIP_PCT_FIELD]: "100",
    [EFFECTIVE_DATE_FIELD]: "01/15/2020",
  };

  it("maps a valid record correctly", () => {
    expect(transformOwnership(baseRecord)).toEqual({
      cms_id: "015001",
      owner_name: "Sunrise Senior Living, LLC",
      owner_type: "Organization",
      ownership_pct: 100,
      effective_date: "2020-01-15",
    });
  });

  it("returns null when cms_id is missing", () => {
    const { [CCN_FIELD]: _, ...rest } = baseRecord;
    expect(transformOwnership(rest)).toBeNull();
  });

  it("returns null when cms_id is blank", () => {
    expect(transformOwnership({ ...baseRecord, [CCN_FIELD]: "   " })).toBeNull();
  });

  it("returns null when owner_name is missing", () => {
    const { [OWNER_NAME_FIELD]: _, ...rest } = baseRecord;
    expect(transformOwnership(rest)).toBeNull();
  });

  it("returns null when owner_name is blank/whitespace", () => {
    expect(transformOwnership({ ...baseRecord, [OWNER_NAME_FIELD]: "  " })).toBeNull();
  });

  it("returns null ownership_pct for non-numeric value", () => {
    expect(
      transformOwnership({ ...baseRecord, [OWNERSHIP_PCT_FIELD]: "N/A" })?.ownership_pct
    ).toBeNull();
  });

  it("returns null ownership_pct when field is absent", () => {
    const { [OWNERSHIP_PCT_FIELD]: _, ...rest } = baseRecord;
    expect(transformOwnership(rest)?.ownership_pct).toBeNull();
  });

  it("returns null effective_date for invalid date", () => {
    expect(
      transformOwnership({ ...baseRecord, [EFFECTIVE_DATE_FIELD]: "not-a-date" })?.effective_date
    ).toBeNull();
  });

  it("returns null effective_date when field is absent", () => {
    const { [EFFECTIVE_DATE_FIELD]: _, ...rest } = baseRecord;
    expect(transformOwnership(rest)?.effective_date).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
npx vitest run scripts/lib/__tests__/transform-ownership.test.ts
```
Expected: `normalizeEntityName` tests still pass; `transformOwnership` tests fail because `transformOwnership` is not yet exported from the module.

- [ ] **Step 3: Implement `transformOwnership` in `scripts/lib/transform-ownership.ts`**

Add below `normalizeEntityName`. Replace the `<FIELD>` constants with the real field names:

```typescript
// !! Replace with actual field names discovered in Task 1 !!
const CCN_FIELD = "<CCN_FIELD>";
const OWNER_NAME_FIELD = "<OWNER_NAME_FIELD>";
const OWNER_TYPE_FIELD = "<OWNER_TYPE_FIELD>";
const OWNERSHIP_PCT_FIELD = "<OWNERSHIP_PCT_FIELD>";
const EFFECTIVE_DATE_FIELD = "<EFFECTIVE_DATE_FIELD>";

function trimOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parsePct(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

// CMS date format: MM/DD/YYYY → ISO: YYYY-MM-DD
function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[1]}-${match[2]}`;
}

export function transformOwnership(raw: CmsRecord): OwnershipRow | null {
  const cmsId = trimOrNull(raw[CCN_FIELD]);
  const ownerName = trimOrNull(raw[OWNER_NAME_FIELD]);
  if (!cmsId || !ownerName) return null;

  return {
    cms_id: cmsId,
    owner_name: ownerName,
    owner_type: trimOrNull(raw[OWNER_TYPE_FIELD]),
    ownership_pct: parsePct(raw[OWNERSHIP_PCT_FIELD]),
    effective_date: parseDate(raw[EFFECTIVE_DATE_FIELD]),
  };
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```
Expected: All tests pass including existing suites.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/transform-ownership.ts scripts/lib/__tests__/transform-ownership.test.ts
git commit -m "feat(PUB-11): add transformOwnership with tests"
```

---

## Chunk 2: Ingestion Script & Workflows

### Task 4: Write failing integration test

**Files:**
- Create: `scripts/__tests__/ingest-ownership.test.ts`

- [ ] **Step 1: Create the integration test file**

`scripts/__tests__/ingest-ownership.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/cms-api", () => ({ fetchAllPages: vi.fn() }));
vi.mock("../lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { fetchAllPages } from "../lib/cms-api";
import { supabaseAdmin } from "../lib/supabase-admin";

const mockFetchAllPages = vi.mocked(fetchAllPages);
const mockFrom = vi.mocked(supabaseAdmin.from);

// !! Replace with actual field names from Task 1 !!
const CCN_FIELD = "<CCN_FIELD>";
const OWNER_NAME_FIELD = "<OWNER_NAME_FIELD>";
const OWNER_TYPE_FIELD = "<OWNER_TYPE_FIELD>";
const OWNERSHIP_PCT_FIELD = "<OWNERSHIP_PCT_FIELD>";
const EFFECTIVE_DATE_FIELD = "<EFFECTIVE_DATE_FIELD>";

describe("ingest-ownership pipeline", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("creates one operator and links both providers when two records share a normalized owner name", async () => {
    // prov 1 + prov 2 share an owner (same after normalization); prov 3 is unique
    mockFetchAllPages.mockResolvedValue([
      {
        [CCN_FIELD]: "111111",
        [OWNER_NAME_FIELD]: "Sunrise Senior Living, LLC",
        [OWNER_TYPE_FIELD]: "Organization",
        [OWNERSHIP_PCT_FIELD]: "100",
        [EFFECTIVE_DATE_FIELD]: "01/01/2020",
      },
      {
        [CCN_FIELD]: "222222",
        [OWNER_NAME_FIELD]: "SUNRISE SENIOR LIVING LLC", // same after normalization
        [OWNER_TYPE_FIELD]: "Organization",
        [OWNERSHIP_PCT_FIELD]: "100",
        [EFFECTIVE_DATE_FIELD]: "01/01/2020",
      },
      {
        [CCN_FIELD]: "333333",
        [OWNER_NAME_FIELD]: "Unique Owner Inc",
        [OWNER_TYPE_FIELD]: "Individual",
        [OWNERSHIP_PCT_FIELD]: "100",
        [EFFECTIVE_DATE_FIELD]: "01/01/2020",
      },
    ]);

    const operatorsInserted: object[] = [];
    const providersLinkedOperatorIds: string[] = [];
    const ownershipLinkedOperatorIds: string[] = [];

    // Phase 2: provider lookup — page 1 returns all 3, page 2 empty
    const provSelectRange = vi.fn()
      .mockResolvedValueOnce({
        data: [
          { id: "prov-1", cms_id: "111111" },
          { id: "prov-2", cms_id: "222222" },
          { id: "prov-3", cms_id: "333333" },
        ],
        error: null,
      })
      .mockResolvedValue({ data: [], error: null });

    // Phase 5: ownership re-fetch — page 1 returns all 3 rows, page 2 empty
    const poSelectRange = vi.fn()
      .mockResolvedValueOnce({
        data: [
          { id: "po-1", owner_name: "Sunrise Senior Living, LLC", provider_id: "prov-1" },
          { id: "po-2", owner_name: "SUNRISE SENIOR LIVING LLC", provider_id: "prov-2" },
          { id: "po-3", owner_name: "Unique Owner Inc", provider_id: "prov-3" },
        ],
        error: null,
      })
      .mockResolvedValue({ data: [], error: null });

    let providersCallCount = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === "providers") {
        providersCallCount++;
        if (providersCallCount === 1) {
          // Phase 2: lookup
          return {
            select: vi.fn().mockReturnValue({ range: provSelectRange }),
          } as unknown as ReturnType<typeof supabaseAdmin.from>;
        }
        // Phase 3 step 2 (null operator_id) and Phase 5 (link operator_id)
        return {
          update: vi.fn().mockImplementation((data: { operator_id: string | null }) => ({
            not: vi.fn().mockResolvedValue({ error: null }),
            in: vi.fn().mockImplementation((_col: string, _ids: string[]) => {
              if (data.operator_id !== null) {
                providersLinkedOperatorIds.push(data.operator_id);
              }
              return Promise.resolve({ error: null });
            }),
          })),
        } as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      if (table === "provider_ownership") {
        return {
          delete: vi.fn().mockReturnValue({
            neq: vi.fn().mockResolvedValue({ error: null }),
          }),
          insert: vi.fn().mockResolvedValue({ error: null, count: 3 }),
          select: vi.fn().mockReturnValue({ range: poSelectRange }),
          update: vi.fn().mockImplementation((data: { operator_id: string }) => ({
            in: vi.fn().mockImplementation((_col: string, _ids: string[]) => {
              ownershipLinkedOperatorIds.push(data.operator_id);
              return Promise.resolve({ error: null });
            }),
          })),
        } as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      if (table === "operators") {
        return {
          delete: vi.fn().mockReturnValue({
            neq: vi.fn().mockResolvedValue({ error: null }),
          }),
          insert: vi.fn().mockImplementation((data: object) => {
            operatorsInserted.push(data);
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "op-uuid-1" },
                  error: null,
                }),
              }),
            };
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const { main } = await import("../ingest-ownership");
    await main();

    // Exactly one operator created (for the matching pair, not the unique owner)
    expect(operatorsInserted).toHaveLength(1);
    expect(operatorsInserted[0]).toMatchObject({ facility_count: 2 });

    // Both matching providers linked via one .in() call
    expect(providersLinkedOperatorIds).toHaveLength(1);
    expect(providersLinkedOperatorIds[0]).toBe("op-uuid-1");

    // Ownership rows for the matching pair linked via one .in() call
    expect(ownershipLinkedOperatorIds).toHaveLength(1);
    expect(ownershipLinkedOperatorIds[0]).toBe("op-uuid-1");
  });

  it("exits with code 1 when zero ownership rows are inserted", async () => {
    // All records have blank CCN → transformOwnership returns null → nothing inserted
    mockFetchAllPages.mockResolvedValue([
      {
        [CCN_FIELD]: "   ",
        [OWNER_NAME_FIELD]: "Some Owner LLC",
        [OWNER_TYPE_FIELD]: "Organization",
        [OWNERSHIP_PCT_FIELD]: "100",
        [EFFECTIVE_DATE_FIELD]: "01/01/2020",
      },
    ]);

    const provSelectRange = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValue({ data: [], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "providers") {
        return {
          select: vi.fn().mockReturnValue({ range: provSelectRange }),
          update: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ error: null }),
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>;
      }
      if (table === "provider_ownership") {
        return {
          delete: vi.fn().mockReturnValue({
            neq: vi.fn().mockResolvedValue({ error: null }),
          }),
          insert: vi.fn().mockResolvedValue({ error: null, count: 0 }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>;
      }
      if (table === "operators") {
        return {
          delete: vi.fn().mockReturnValue({
            neq: vi.fn().mockResolvedValue({ error: null }),
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit called");
      });

    const { main } = await import("../ingest-ownership");
    await expect(main()).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx vitest run scripts/__tests__/ingest-ownership.test.ts
```
Expected: Both tests fail with `Cannot find module '../ingest-ownership'`.

---

### Task 5: Implement `ingest-ownership.ts` Phases 1–4

**Files:**
- Create: `scripts/ingest-ownership.ts`

- [ ] **Step 1: Create the file with all five phases**

`scripts/ingest-ownership.ts`:
```typescript
import { fetchAllPages } from "./lib/cms-api";
import { supabaseAdmin } from "./lib/supabase-admin";
import {
  transformOwnership,
  normalizeEntityName,
} from "./lib/transform-ownership";

const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;

// Phase 2
async function buildProviderLookup(): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  let from = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("id, cms_id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Fetch providers failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) lookup.set(row.cms_id, row.id);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return lookup;
}

// Phase 3
async function clearExistingData(): Promise<void> {
  const { error: poError } = await supabaseAdmin
    .from("provider_ownership")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (poError) throw new Error(`Clear provider_ownership failed: ${poError.message}`);

  const { error: provError } = await supabaseAdmin
    .from("providers")
    .update({ operator_id: null })
    .not("operator_id", "is", null);
  if (provError) throw new Error(`Clear providers.operator_id failed: ${provError.message}`);

  const { error: opError } = await supabaseAdmin
    .from("operators")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (opError) throw new Error(`Clear operators failed: ${opError.message}`);
}

// Phase 4
interface OwnershipInsertRow {
  provider_id: string;
  owner_name: string;
  owner_type: string | null;
  ownership_pct: number | null;
  effective_date: string | null;
  operator_id: null;
}

async function insertBatch(batch: OwnershipInsertRow[]): Promise<number> {
  const { error, count } = await supabaseAdmin
    .from("provider_ownership")
    .insert(batch);
  if (error) throw new Error(`Insert ownership batch failed: ${error.message}`);
  return count ?? batch.length;
}

// Phase 5
interface OwnershipFetchRow {
  id: string;
  owner_name: string;
  provider_id: string;
}

async function fetchAllOwnershipRows(): Promise<OwnershipFetchRow[]> {
  const rows: OwnershipFetchRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("provider_ownership")
      .select("id, owner_name, provider_id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Fetch ownership rows failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as OwnershipFetchRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function matchAndLinkOperators(rows: OwnershipFetchRow[]): Promise<number> {
  const groups = new Map<
    string,
    { rowIds: string[]; providerIds: Set<string>; rawNames: string[] }
  >();

  for (const row of rows) {
    const normalized = normalizeEntityName(row.owner_name);
    if (!normalized) continue;

    const group = groups.get(normalized);
    if (group) {
      group.rowIds.push(row.id);
      group.providerIds.add(row.provider_id);
      group.rawNames.push(row.owner_name);
    } else {
      groups.set(normalized, {
        rowIds: [row.id],
        providerIds: new Set([row.provider_id]),
        rawNames: [row.owner_name],
      });
    }
  }

  let operatorsCreated = 0;

  for (const [, group] of groups) {
    if (group.providerIds.size < 2) continue; // single-facility owner — skip

    // Deterministic: alphabetically first raw owner_name
    const operatorName = [...group.rawNames].sort()[0];
    const facilityCount = group.providerIds.size;

    const { data: opData, error: opError } = await supabaseAdmin
      .from("operators")
      .insert({ name: operatorName, facility_count: facilityCount })
      .select("id")
      .single();

    if (opError || !opData) {
      throw new Error(`Insert operator failed: ${opError?.message ?? "no data"}`);
    }

    const operatorId = opData.id;

    const { error: poError } = await supabaseAdmin
      .from("provider_ownership")
      .update({ operator_id: operatorId })
      .in("id", group.rowIds);
    if (poError) throw new Error(`Update provider_ownership failed: ${poError.message}`);

    const { error: provError } = await supabaseAdmin
      .from("providers")
      .update({ operator_id: operatorId })
      .in("id", Array.from(group.providerIds));
    if (provError) throw new Error(`Update providers failed: ${provError.message}`);

    operatorsCreated++;
  }

  return operatorsCreated;
}

export async function main() {
  console.log("Starting ownership data ingestion...\n");

  // Phase 1: Fetch
  console.log("Phase 1: Fetching CMS ownership data...");
  const rawRecords = await fetchAllPages("y2hd-n93e");
  console.log(`Fetched ${rawRecords.length} raw ownership records`);

  // Phase 2: Provider lookup
  console.log("\nPhase 2: Building provider lookup map...");
  const providerLookup = await buildProviderLookup();
  console.log(`Lookup built: ${providerLookup.size} providers`);

  // Phase 3: Full replace teardown
  console.log("\nPhase 3: Clearing existing ownership data...");
  await clearExistingData();
  console.log("Existing data cleared");

  // Phase 4: Transform and insert
  console.log("\nPhase 4: Inserting ownership rows...");
  const toInsert: OwnershipInsertRow[] = [];
  let skipped = 0;

  for (const raw of rawRecords) {
    const row = transformOwnership(raw);
    if (!row) { skipped++; continue; }
    const providerId = providerLookup.get(row.cms_id);
    if (!providerId) { skipped++; continue; }

    toInsert.push({
      provider_id: providerId,
      owner_name: row.owner_name,
      owner_type: row.owner_type,
      ownership_pct: row.ownership_pct,
      effective_date: row.effective_date,
      operator_id: null,
    });
  }

  console.log(`Transformed ${toInsert.length} rows (${skipped} skipped)`);

  let totalInserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const count = await insertBatch(batch);
    totalInserted += count;
    console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${count} rows`);
  }

  if (totalInserted === 0) {
    console.error("Zero ownership rows inserted — possible CMS API failure. Exiting.");
    process.exit(1);
  }

  console.log(`Total inserted: ${totalInserted} ownership rows`);

  // Phase 5: Match and link operators
  console.log("\nPhase 5: Matching owners and linking operators...");
  const ownershipRows = await fetchAllOwnershipRows();
  console.log(`Fetched ${ownershipRows.length} ownership rows for matching`);

  const operatorsCreated = await matchAndLinkOperators(ownershipRows);
  console.log(`Created ${operatorsCreated} operators`);

  console.log("\n--- Ingestion Summary ---");
  console.log(`Raw records fetched:     ${rawRecords.length}`);
  console.log(`Ownership rows inserted: ${totalInserted}`);
  console.log(`Rows skipped:            ${skipped}`);
  console.log(`Operators created:       ${operatorsCreated}`);
  console.log("Ingestion complete.");
}

const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Ownership ingestion failed:", error);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Run the integration tests**

```bash
npx vitest run scripts/__tests__/ingest-ownership.test.ts
```
Expected: Both tests pass.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-ownership.ts scripts/__tests__/ingest-ownership.test.ts
git commit -m "feat(PUB-11): implement ingest-ownership pipeline with tests"
```

---

### Task 6: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/ingest-ownership.yml`
- Modify: `.github/workflows/compute-risk-scores.yml`

- [ ] **Step 1: Create `.github/workflows/ingest-ownership.yml`**

```yaml
name: Ingest Ownership

on:
  schedule:
    - cron: '0 2 * * 1'  # Monday 2am UTC
  workflow_dispatch:

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx tsx scripts/ingest-ownership.ts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 2: Add `Ingest Ownership` to `compute-risk-scores.yml`**

In `.github/workflows/compute-risk-scores.yml`, find the `workflow_run.workflows` list and add one entry. The result should be:

```yaml
    workflows:
      - Ingest Providers
      - Ingest Deficiencies
      - Ingest Penalties
      - Ingest HCRIS Cost Reports
      - Ingest Ownership
```

The string `Ingest Ownership` must exactly match the `name:` field in `ingest-ownership.yml`. A mismatch silently prevents the trigger from firing.

- [ ] **Step 3: Run full test suite one final time**

```bash
npm test
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ingest-ownership.yml .github/workflows/compute-risk-scores.yml
git commit -m "feat(PUB-11): add ingest-ownership workflow, trigger compute-risk-scores"
```
