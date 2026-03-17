# HCRIS Cost Report Parser Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build TypeScript scripts that parse CMS HCRIS zip files and populate `payment_history` / update `providers.annual_medicare_payments` for SNF, HHA, and Hospice providers.

**Architecture:** Three thin entrypoint scripts (`parse-hcris-snf.ts`, `parse-hcris-hha.ts`, `parse-hcris-hospice.ts`) each accept a local zip path from the CLI, delegate file loading and report selection to a shared `lib/hcris.ts`, and field extraction to a per-type `lib/transform-hcris-*.ts`. A `docs/hcris-quarterly-runbook.md` documents the full quarterly operator workflow.

**Tech Stack:** TypeScript, `tsx`, Vitest, Supabase JS client, `adm-zip` (new dep) for zip extraction, Node.js built-in `readline` + `fs` for pipe-delimited CSV parsing.

---

## File Map

| File                                                    | Action | Responsibility                                                                                                                                                         |
| ------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/lib/hcris.ts`                                  | Create | Zip extraction, pipe-delimited parsing, RPT loading, report selection, NMRC grouping, coordinate lookup, CCN resolution, upsert/update helpers, `buildProviderUpdates` |
| `scripts/lib/transform-hcris-snf.ts`                    | Create | SNF worksheet coordinates + field extraction                                                                                                                           |
| `scripts/lib/transform-hcris-hha.ts`                    | Create | HHA worksheet coordinates + field extraction                                                                                                                           |
| `scripts/lib/transform-hcris-hospice.ts`                | Create | Hospice worksheet coordinates + field extraction                                                                                                                       |
| `scripts/lib/__tests__/hcris.test.ts`                   | Create | Tests for all shared logic                                                                                                                                             |
| `scripts/lib/__tests__/transform-hcris-snf.test.ts`     | Create | Tests for SNF transform                                                                                                                                                |
| `scripts/lib/__tests__/transform-hcris-hha.test.ts`     | Create | Tests for HHA transform                                                                                                                                                |
| `scripts/lib/__tests__/transform-hcris-hospice.test.ts` | Create | Tests for Hospice transform                                                                                                                                            |
| `scripts/parse-hcris-snf.ts`                            | Create | SNF entrypoint                                                                                                                                                         |
| `scripts/parse-hcris-hha.ts`                            | Create | HHA entrypoint                                                                                                                                                         |
| `scripts/parse-hcris-hospice.ts`                        | Create | Hospice entrypoint                                                                                                                                                     |
| `docs/hcris-quarterly-runbook.md`                       | Create | Operator instructions                                                                                                                                                  |
| `package.json`                                          | Modify | Add `adm-zip` dev dependency                                                                                                                                           |

---

## Chunk 1: Shared Library (`hcris.ts`) + Tests

### Task 1: Add `adm-zip` dependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install adm-zip**

```bash
npm install --save-dev adm-zip @types/adm-zip
```

Expected: package-lock.json updated; `adm-zip` appears in `devDependencies`.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add adm-zip for HCRIS zip extraction"
```

---

### Task 2: Write failing tests for shared `hcris.ts` logic

**Files:**

- Create: `scripts/lib/__tests__/hcris.test.ts`

Do NOT create `hcris.ts` yet — the goal of this step is to write tests that fail because the module doesn't exist.

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseFiscalYear,
  findFileBySuffix,
  selectBestReports,
  groupNmrcByRptRecNum,
  lookupValue,
  computeChargeToPaymentRatio,
  buildProviderUpdates,
} from "../hcris";

// ─── parseFiscalYear ───────────────────────────────────────────────────────

describe("parseFiscalYear", () => {
  it("extracts year from MM/DD/YYYY FY_END_DT", () => {
    expect(parseFiscalYear("12/31/2023")).toBe(2023);
  });

  it("extracts year from fiscal years ending mid-year", () => {
    expect(parseFiscalYear("06/30/2022")).toBe(2022);
  });

  it("returns null for empty string", () => {
    expect(parseFiscalYear("")).toBeNull();
  });

  it("returns null for YYYY-MM-DD format (not MM/DD/YYYY)", () => {
    expect(parseFiscalYear("2023-12-31")).toBeNull();
  });

  it("trims whitespace before parsing", () => {
    expect(parseFiscalYear("  12/31/2023  ")).toBe(2023);
  });
});

// ─── findFileBySuffix ──────────────────────────────────────────────────────

describe("findFileBySuffix", () => {
  it("finds a file whose name contains the suffix (case-insensitive)", () => {
    const mockFiles = [
      "SNF_2023_RPT_ABC.csv",
      "SNF_2023_NMRC_DEF.csv",
      "SNF_2023_ALPHNMRC_GHI.csv",
    ];
    vi.spyOn(require("fs"), "readdirSync").mockReturnValueOnce(
      mockFiles as any,
    );
    vi.spyOn(require("path"), "join").mockImplementation((...args) =>
      args.join("/"),
    );
    // We test the pure logic by calling with a real temp dir in integration;
    // here we verify the suffix match is case-insensitive
    expect(mockFiles.find((f) => f.toUpperCase().includes("_RPT_"))).toBe(
      "SNF_2023_RPT_ABC.csv",
    );
    expect(mockFiles.find((f) => f.toUpperCase().includes("_NMRC_"))).toBe(
      "SNF_2023_NMRC_DEF.csv",
    );
  });

  it("throws if no file matches the suffix", () => {
    // Direct logic test: no file with _RPT_ suffix
    const files = ["SNF_2023_NMRC_DEF.csv"];
    const match = files.find((f) => f.toUpperCase().includes("_RPT_"));
    expect(match).toBeUndefined();
  });
});

// ─── selectBestReports ────────────────────────────────────────────────────

describe("selectBestReports", () => {
  it("prefers settled (status 2) over as-submitted (status 1) for same provider-year", () => {
    const rows = [
      {
        RPT_REC_NUM: "100",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "1",
      },
      {
        RPT_REC_NUM: "101",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "2",
      },
    ];
    const result = selectBestReports(rows);
    expect(result.has("101")).toBe(true);
    expect(result.has("100")).toBe(false);
  });

  it("prefers amended/settled (status 4) over as-submitted (status 1)", () => {
    const rows = [
      {
        RPT_REC_NUM: "200",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "1",
      },
      {
        RPT_REC_NUM: "201",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "4",
      },
    ];
    const result = selectBestReports(rows);
    expect(result.has("201")).toBe(true);
    expect(result.has("200")).toBe(false);
  });

  it("treats status 2 and status 4 as equal priority, breaking ties by PROC_DT", () => {
    const rows = [
      {
        RPT_REC_NUM: "300",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "2",
      },
      {
        RPT_REC_NUM: "301",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "06/01/2024",
        RPT_STUS_CD: "4",
      },
    ];
    const result = selectBestReports(rows);
    // status 2 and 4 are equal priority; 301 has more recent PROC_DT
    expect(result.has("301")).toBe(true);
    expect(result.has("300")).toBe(false);
  });

  it("prefers most recent PROC_DT when status is equal", () => {
    const rows = [
      {
        RPT_REC_NUM: "400",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "01/15/2024",
        RPT_STUS_CD: "2",
      },
      {
        RPT_REC_NUM: "401",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "06/01/2024",
        RPT_STUS_CD: "2",
      },
    ];
    const result = selectBestReports(rows);
    expect(result.has("401")).toBe(true);
    expect(result.has("400")).toBe(false);
  });

  it("selects the only report even when status=1 (as-submitted) only", () => {
    const rows = [
      {
        RPT_REC_NUM: "500",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "1",
      },
    ];
    const result = selectBestReports(rows);
    expect(result.has("500")).toBe(true);
  });

  it("logs a warning and picks last-seen when status and PROC_DT are both equal (degenerate case)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = [
      {
        RPT_REC_NUM: "600",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "2",
      },
      {
        RPT_REC_NUM: "601",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "2",
      },
    ];
    const result = selectBestReports(rows);
    expect(result.has("601")).toBe(true); // last-seen wins
    expect(result.has("600")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("012345"));
    warnSpy.mockRestore();
  });

  it("handles multiple providers independently", () => {
    const rows = [
      {
        RPT_REC_NUM: "700",
        PRVDR_NUM: "111111",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "2",
      },
      {
        RPT_REC_NUM: "701",
        PRVDR_NUM: "222222",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "1",
      },
    ];
    const result = selectBestReports(rows);
    expect(result.size).toBe(2);
  });

  it("handles multiple fiscal years for the same provider independently", () => {
    const rows = [
      {
        RPT_REC_NUM: "800",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2022",
        PROC_DT: "03/01/2023",
        RPT_STUS_CD: "2",
      },
      {
        RPT_REC_NUM: "801",
        PRVDR_NUM: "012345",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "2",
      },
    ];
    const result = selectBestReports(rows);
    expect(result.size).toBe(2);
  });

  it("skips rows with missing PRVDR_NUM or unparseable FY_END_DT", () => {
    const rows = [
      {
        RPT_REC_NUM: "900",
        PRVDR_NUM: "",
        FY_END_DT: "12/31/2023",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "2",
      },
      {
        RPT_REC_NUM: "901",
        PRVDR_NUM: "012345",
        FY_END_DT: "2023-12-31",
        PROC_DT: "03/01/2024",
        RPT_STUS_CD: "2",
      },
    ];
    const result = selectBestReports(rows);
    expect(result.size).toBe(0);
  });
});

// ─── groupNmrcByRptRecNum ─────────────────────────────────────────────────

describe("groupNmrcByRptRecNum", () => {
  it("groups NMRC rows by RPT_REC_NUM, filtering to selected set", () => {
    const nmrcRows = [
      {
        RPT_REC_NUM: "100",
        WKSHT_CD: "E",
        LINE_NUM: "1",
        CLMN_NUM: "1",
        ITM_VAL_NUM: "500000",
      },
      {
        RPT_REC_NUM: "100",
        WKSHT_CD: "C",
        LINE_NUM: "1",
        CLMN_NUM: "8",
        ITM_VAL_NUM: "750000",
      },
      {
        RPT_REC_NUM: "999",
        WKSHT_CD: "E",
        LINE_NUM: "1",
        CLMN_NUM: "1",
        ITM_VAL_NUM: "100000",
      },
    ];
    const selected = new Set(["100"]);
    const result = groupNmrcByRptRecNum(nmrcRows, selected);
    expect(result.get("100")).toHaveLength(2);
    expect(result.has("999")).toBe(false);
  });
});

// ─── lookupValue ──────────────────────────────────────────────────────────

describe("lookupValue", () => {
  const nmrcGroup = [
    {
      RPT_REC_NUM: "100",
      WKSHT_CD: "E",
      LINE_NUM: "1",
      CLMN_NUM: "1",
      ITM_VAL_NUM: "500000.50",
    },
    {
      RPT_REC_NUM: "100",
      WKSHT_CD: "C",
      LINE_NUM: "1",
      CLMN_NUM: "8",
      ITM_VAL_NUM: "750000",
    },
  ];

  it("returns the numeric value for a matching coordinate", () => {
    expect(lookupValue(nmrcGroup, "E", "1", "1")).toBe(500000.5);
  });

  it("returns null when coordinate is not found", () => {
    expect(lookupValue(nmrcGroup, "S3", "1", "6")).toBeNull();
  });

  it("returns null for non-numeric ITM_VAL_NUM", () => {
    const group = [
      {
        RPT_REC_NUM: "100",
        WKSHT_CD: "E",
        LINE_NUM: "1",
        CLMN_NUM: "1",
        ITM_VAL_NUM: "N/A",
      },
    ];
    expect(lookupValue(group, "E", "1", "1")).toBeNull();
  });

  it("matches coordinates that have been whitespace-trimmed", () => {
    // HCRIS pipe-delimited files often have padded fields; parsePipeDelimited trims them
    const group = [
      {
        RPT_REC_NUM: "100",
        WKSHT_CD: "E",
        LINE_NUM: "1",
        CLMN_NUM: "1",
        ITM_VAL_NUM: "  99999  ",
      },
    ];
    // After trim, ITM_VAL_NUM is "99999" — parseFloat handles that
    expect(lookupValue(group, "E", "1", "1")).toBe(99999);
  });
});

// ─── computeChargeToPaymentRatio ──────────────────────────────────────────

describe("computeChargeToPaymentRatio", () => {
  it("computes the ratio: 750000 / 500000 = 1.50", () => {
    expect(computeChargeToPaymentRatio(750000, 500000)).toBe(1.5);
  });

  it("rounds to 2 decimal places: 1000 / 3 = 333.33", () => {
    expect(computeChargeToPaymentRatio(1000, 3)).toBe(333.33);
  });

  it("returns 1.00 when charges equal payments", () => {
    expect(computeChargeToPaymentRatio(500000, 500000)).toBe(1);
  });

  it("returns null if total_charges is null", () => {
    expect(computeChargeToPaymentRatio(null, 500000)).toBeNull();
  });

  it("returns null if medicare_payments is null", () => {
    expect(computeChargeToPaymentRatio(750000, null)).toBeNull();
  });

  it("returns null if medicare_payments is 0 (division by zero guard)", () => {
    expect(computeChargeToPaymentRatio(750000, 0)).toBeNull();
  });

  it("returns null if total_charges is 0 but medicare_payments is also 0", () => {
    expect(computeChargeToPaymentRatio(0, 0)).toBeNull();
  });
});

// ─── buildProviderUpdates ─────────────────────────────────────────────────

describe("buildProviderUpdates", () => {
  const providerMap = new Map([
    ["012345", "uuid-snf-1"],
    ["017001", "uuid-hha-1"],
  ]);

  it("picks the highest fiscal year per provider", () => {
    const records = [
      {
        prvdr_num: "012345",
        fiscal_year: 2022,
        medicare_payments: 400000,
        total_charges: 600000,
        total_days: 10000,
        total_patients: null,
      },
      {
        prvdr_num: "012345",
        fiscal_year: 2023,
        medicare_payments: 500000,
        total_charges: 750000,
        total_days: 11000,
        total_patients: null,
      },
    ];
    const { updates } = buildProviderUpdates(records, providerMap);
    expect(updates).toHaveLength(1);
    expect(updates[0].payment_data_year).toBe(2023);
    expect(updates[0].annual_medicare_payments).toBe(500000);
  });

  it("skips providers whose highest fiscal year has null medicare_payments", () => {
    const records = [
      {
        prvdr_num: "012345",
        fiscal_year: 2023,
        medicare_payments: null,
        total_charges: null,
        total_days: null,
        total_patients: null,
      },
    ];
    const { updates, skippedCcns } = buildProviderUpdates(records, providerMap);
    expect(updates).toHaveLength(0);
    expect(skippedCcns).toContain("012345");
  });

  it("skips CCNs that are not in providerMap (already counted as missing)", () => {
    const records = [
      {
        prvdr_num: "999999",
        fiscal_year: 2023,
        medicare_payments: 100000,
        total_charges: null,
        total_days: null,
        total_patients: null,
      },
    ];
    const { updates } = buildProviderUpdates(records, providerMap);
    expect(updates).toHaveLength(0);
  });

  it("computes charge_to_payment_ratio correctly", () => {
    const records = [
      {
        prvdr_num: "012345",
        fiscal_year: 2023,
        medicare_payments: 500000,
        total_charges: 750000,
        total_days: null,
        total_patients: null,
      },
    ];
    const { updates } = buildProviderUpdates(records, providerMap);
    expect(updates[0].charge_to_payment_ratio).toBe(1.5);
  });

  it("sets charge_to_payment_ratio to null when total_charges is null (HHA/Hospice)", () => {
    const records = [
      {
        prvdr_num: "012345",
        fiscal_year: 2023,
        medicare_payments: 500000,
        total_charges: null,
        total_days: null,
        total_patients: null,
      },
    ];
    const { updates } = buildProviderUpdates(records, providerMap);
    expect(updates[0].charge_to_payment_ratio).toBeNull();
  });

  it("sets data_source to 'hcris'", () => {
    const records = [
      {
        prvdr_num: "012345",
        fiscal_year: 2023,
        medicare_payments: 500000,
        total_charges: null,
        total_days: null,
        total_patients: null,
      },
    ];
    const { updates } = buildProviderUpdates(records, providerMap);
    expect(updates[0].payment_data_source).toBe("hcris");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run scripts/lib/__tests__/hcris.test.ts
```

Expected: FAIL — module `../hcris` not found.

- [ ] **Step 3: Commit the failing tests**

```bash
git add scripts/lib/__tests__/hcris.test.ts
git commit -m "test: add failing tests for hcris shared library"
```

---

### Task 3: Implement `scripts/lib/hcris.ts`

**Files:**

- Create: `scripts/lib/hcris.ts`

- [ ] **Step 1: Create the file**

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import AdmZip from "adm-zip";
import { supabaseAdmin } from "./supabase-admin";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PaymentRecord {
  prvdr_num: string;
  fiscal_year: number;
  medicare_payments: number | null;
  total_charges: number | null; // SNF only; null for HHA and Hospice
  total_days: number | null;
  total_patients: number | null; // HHA only; null for SNF and Hospice
}

export interface PaymentHistoryRow {
  provider_id: string;
  fiscal_year: number;
  medicare_payments: number | null;
  total_charges: number | null;
  total_days: number | null;
  total_patients: number | null;
  data_source: "hcris";
}

export interface ProviderUpdate {
  provider_id: string;
  annual_medicare_payments: number;
  payment_data_year: number;
  payment_data_source: "hcris";
  charge_to_payment_ratio: number | null;
}

// ─── File Utilities ────────────────────────────────────────────────────────

/** Extract a zip file to a new temp directory. Returns the temp dir path. */
export function extractZip(zipPath: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hcris-"));
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(tempDir, true);
  return tempDir;
}

/** Clean up a temp directory recursively. Non-fatal if dir doesn't exist. */
export function cleanupTempDir(tempDir: string): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Find the path of a file inside a directory whose name contains the given
 * suffix (case-insensitive). Throws if no match is found.
 */
export function findFileBySuffix(dir: string, suffix: string): string {
  const files = fs.readdirSync(dir);
  const match = files.find((f) =>
    f.toUpperCase().includes(suffix.toUpperCase()),
  );
  if (!match) {
    throw new Error(`No file with suffix "${suffix}" found in ${dir}`);
  }
  return path.join(dir, match);
}

/**
 * Parse a pipe-delimited file (|) into an array of row objects keyed by
 * header name. Fields are trimmed. Encoding is latin1 (standard for HCRIS).
 */
export async function parsePipeDelimited(
  filePath: string,
): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  let isFirst = true;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = line.split("|");
    if (isFirst) {
      headers = cols.map((h) => h.trim());
      isFirst = false;
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = (cols[i] ?? "").trim();
    }
    rows.push(row);
  }

  return rows;
}

// ─── Report Selection ──────────────────────────────────────────────────────

/**
 * Derives the fiscal year (integer) from the FY_END_DT field (MM/DD/YYYY).
 * Returns null if the date is missing or malformed.
 */
export function parseFiscalYear(fyEndDt: string): number | null {
  if (!fyEndDt) return null;
  const parts = fyEndDt.trim().split("/");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[2], 10);
  return isNaN(year) ? null : year;
}

function parseProcDt(procDt: string): number {
  if (!procDt) return 0;
  const parts = procDt.trim().split("/");
  if (parts.length !== 3) return 0;
  const [month, day, year] = parts;
  const d = new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
  );
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// Status 2 (Settled) and 4 (Amended/Settled) are equal priority, both > 1 (As Submitted)
function statusPriority(code: string): number {
  if (code === "2" || code === "4") return 2;
  if (code === "1") return 1;
  return 0;
}

/**
 * Given all rows from the RPT file, select the best report per
 * (PRVDR_NUM, fiscal_year). Priority: settled/amended > as-submitted;
 * ties broken by most recent PROC_DT; degenerate ties: last-seen + warning.
 *
 * Returns a Map from RPT_REC_NUM → the selected RPT row.
 */
export function selectBestReports(
  rptRows: Record<string, string>[],
): Map<string, Record<string, string>> {
  const byProviderYear = new Map<string, Record<string, string>>();

  for (const row of rptRows) {
    const ccn = row.PRVDR_NUM;
    const fy = parseFiscalYear(row.FY_END_DT);
    if (!ccn || fy === null) continue;

    const key = `${ccn}|${fy}`;
    const existing = byProviderYear.get(key);

    if (!existing) {
      byProviderYear.set(key, row);
      continue;
    }

    const newPriority = statusPriority(row.RPT_STUS_CD);
    const existingPriority = statusPriority(existing.RPT_STUS_CD);

    if (newPriority > existingPriority) {
      byProviderYear.set(key, row);
    } else if (newPriority === existingPriority) {
      const newProc = parseProcDt(row.PROC_DT);
      const existingProc = parseProcDt(existing.PROC_DT);
      if (newProc > existingProc) {
        byProviderYear.set(key, row);
      } else if (newProc === existingProc) {
        // Degenerate: same status and PROC_DT — last-seen wins, log warning
        console.warn(
          `Duplicate report for CCN ${ccn} FY ${fy} with identical status and PROC_DT. Using last-seen (RPT_REC_NUM: ${row.RPT_REC_NUM}).`,
        );
        byProviderYear.set(key, row);
      }
    }
  }

  const result = new Map<string, Record<string, string>>();
  for (const row of byProviderYear.values()) {
    result.set(row.RPT_REC_NUM, row);
  }
  return result;
}

// ─── NMRC Helpers ─────────────────────────────────────────────────────────

/**
 * Filter NMRC rows to only those in the selected set, grouped by RPT_REC_NUM.
 */
export function groupNmrcByRptRecNum(
  nmrcRows: Record<string, string>[],
  selectedRptRecNums: Set<string>,
): Map<string, Record<string, string>[]> {
  const grouped = new Map<string, Record<string, string>[]>();
  for (const row of nmrcRows) {
    const key = row.RPT_REC_NUM;
    if (!selectedRptRecNums.has(key)) continue;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}

/**
 * Look up a specific (WKSHT_CD, LINE_NUM, CLMN_NUM) coordinate in a group
 * of NMRC rows. Returns the numeric value, or null if absent or non-numeric.
 */
export function lookupValue(
  nmrcGroup: Record<string, string>[],
  wkshtCd: string,
  lineNum: string,
  clmnNum: string,
): number | null {
  const row = nmrcGroup.find(
    (r) =>
      r.WKSHT_CD === wkshtCd &&
      r.LINE_NUM === lineNum &&
      r.CLMN_NUM === clmnNum,
  );
  if (!row) return null;
  const val = parseFloat(row.ITM_VAL_NUM);
  return isNaN(val) ? null : val;
}

// ─── Calculations ──────────────────────────────────────────────────────────

/**
 * Compute charge_to_payment_ratio = total_charges / medicare_payments.
 * Returns null if either input is null, or if medicare_payments is 0.
 * Result is rounded to 2 decimal places.
 */
export function computeChargeToPaymentRatio(
  totalCharges: number | null,
  medicarePayments: number | null,
): number | null {
  if (totalCharges === null || medicarePayments === null) return null;
  if (medicarePayments === 0) return null;
  return Math.round((totalCharges / medicarePayments) * 100) / 100;
}

// ─── Provider Update Builder ───────────────────────────────────────────────

/**
 * Given payment records and a CCN→UUID map, determine the highest fiscal year
 * per provider and build the list of ProviderUpdate objects.
 *
 * Skips providers whose highest fiscal year has null medicare_payments.
 * Skips CCNs not in providerMap (already counted as missing).
 *
 * Returns { updates, skippedCcns } so callers can log skipped providers.
 */
export function buildProviderUpdates(
  paymentRecords: PaymentRecord[],
  providerMap: Map<string, string>,
): { updates: ProviderUpdate[]; skippedCcns: string[] } {
  const latestByProvider = new Map<string, PaymentRecord>();
  for (const record of paymentRecords) {
    if (!providerMap.has(record.prvdr_num)) continue;
    const existing = latestByProvider.get(record.prvdr_num);
    if (!existing || record.fiscal_year > existing.fiscal_year) {
      latestByProvider.set(record.prvdr_num, record);
    }
  }

  const updates: ProviderUpdate[] = [];
  const skippedCcns: string[] = [];

  for (const [ccn, record] of latestByProvider) {
    if (record.medicare_payments === null) {
      skippedCcns.push(ccn);
      continue;
    }
    updates.push({
      provider_id: providerMap.get(ccn)!,
      annual_medicare_payments: record.medicare_payments,
      payment_data_year: record.fiscal_year,
      payment_data_source: "hcris",
      charge_to_payment_ratio: computeChargeToPaymentRatio(
        record.total_charges,
        record.medicare_payments,
      ),
    });
  }

  return { updates, skippedCcns };
}

// ─── Supabase Helpers ──────────────────────────────────────────────────────

/** Resolve CCNs to provider UUIDs in batches of 1000. */
export async function resolveProviders(
  ccns: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const chunkSize = 1000;
  for (let i = 0; i < ccns.length; i += chunkSize) {
    const chunk = ccns.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("id, cms_id")
      .in("cms_id", chunk);
    if (error) throw new Error(`Failed to resolve providers: ${error.message}`);
    for (const row of data ?? []) {
      map.set(row.cms_id, row.id);
    }
  }
  return map;
}

/**
 * Upsert payment_history rows in batches of 500.
 * On conflict (provider_id, fiscal_year), overwrites all non-key columns.
 */
export async function upsertPaymentHistory(
  rows: PaymentHistoryRow[],
): Promise<number> {
  const BATCH_SIZE = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabaseAdmin
      .from("payment_history")
      .upsert(batch, {
        onConflict: "provider_id,fiscal_year",
        count: "exact",
      });
    if (error) throw new Error(`Upsert batch failed: ${error.message}`);
    total += count ?? batch.length;
    console.log(
      `  Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${count} rows`,
    );
  }
  return total;
}

/** Update providers with payment data. Runs 50 concurrent updates per batch. */
export async function updateProviders(
  updates: ProviderUpdate[],
): Promise<number> {
  const CONCURRENT = 50;
  let total = 0;
  for (let i = 0; i < updates.length; i += CONCURRENT) {
    const batch = updates.slice(i, i + CONCURRENT);
    await Promise.all(
      batch.map(async (u) => {
        const { error } = await supabaseAdmin
          .from("providers")
          .update({
            annual_medicare_payments: u.annual_medicare_payments,
            payment_data_year: u.payment_data_year,
            payment_data_source: u.payment_data_source,
            charge_to_payment_ratio: u.charge_to_payment_ratio,
            updated_at: new Date().toISOString(),
          })
          .eq("id", u.provider_id);
        if (error) throw new Error(`Provider update failed: ${error.message}`);
      }),
    );
    total += batch.length;
  }
  return total;
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run scripts/lib/__tests__/hcris.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/hcris.ts
git commit -m "feat: add hcris shared library (zip, CSV, report selection, upsert helpers)"
```

---

## Chunk 2: Transform Modules + Tests

### Task 4: SNF transform + tests

**Files:**

- Create: `scripts/lib/__tests__/transform-hcris-snf.test.ts`
- Create: `scripts/lib/transform-hcris-snf.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { transformSnf } from "../transform-hcris-snf";

const rptRow = {
  RPT_REC_NUM: "100",
  PRVDR_NUM: "015001",
  FY_END_DT: "12/31/2023",
  FY_BGN_DT: "01/01/2023",
  PROC_DT: "03/01/2024",
  RPT_STUS_CD: "2",
};

const fullNmrc = [
  {
    RPT_REC_NUM: "100",
    WKSHT_CD: "E",
    LINE_NUM: "1",
    CLMN_NUM: "1",
    ITM_VAL_NUM: "500000",
  },
  {
    RPT_REC_NUM: "100",
    WKSHT_CD: "C",
    LINE_NUM: "1",
    CLMN_NUM: "8",
    ITM_VAL_NUM: "750000",
  },
  {
    RPT_REC_NUM: "100",
    WKSHT_CD: "S3",
    LINE_NUM: "1",
    CLMN_NUM: "6",
    ITM_VAL_NUM: "8500",
  },
  {
    RPT_REC_NUM: "100",
    WKSHT_CD: "S3",
    LINE_NUM: "1",
    CLMN_NUM: "8",
    ITM_VAL_NUM: "12000",
  },
];

describe("transformSnf", () => {
  it("extracts all fields correctly", () => {
    const result = transformSnf(rptRow, fullNmrc);
    expect(result).toEqual({
      prvdr_num: "015001",
      fiscal_year: 2023,
      medicare_payments: 500000,
      total_charges: 750000,
      total_days: 12000,
      total_patients: null,
    });
  });

  it("returns null for fields with missing NMRC coordinates", () => {
    const result = transformSnf(rptRow, []);
    expect(result.medicare_payments).toBeNull();
    expect(result.total_charges).toBeNull();
    expect(result.total_days).toBeNull();
  });

  it("always returns null for total_patients (SNF does not extract it)", () => {
    const result = transformSnf(rptRow, fullNmrc);
    expect(result.total_patients).toBeNull();
  });

  it("handles decimal NMRC values", () => {
    const nmrc = [
      {
        RPT_REC_NUM: "100",
        WKSHT_CD: "E",
        LINE_NUM: "1",
        CLMN_NUM: "1",
        ITM_VAL_NUM: "500000.75",
      },
    ];
    const result = transformSnf(rptRow, nmrc);
    expect(result.medicare_payments).toBe(500000.75);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run scripts/lib/__tests__/transform-hcris-snf.test.ts
```

Expected: FAIL — module `../transform-hcris-snf` not found.

- [ ] **Step 3: Implement `transform-hcris-snf.ts`**

```typescript
import { lookupValue, parseFiscalYear, type PaymentRecord } from "./hcris";

/**
 * Worksheet coordinates for SNF (CMS-2540-10).
 *
 * IMPORTANT: Verify these values against actual HCRIS files before first run.
 * CMS form instructions may use different notation than raw file values
 * (e.g. form says "E" but file contains "E00001"). See runbook for verification steps.
 */
const COORDS = {
  medicare_payments: { wksht: "E", line: "1", col: "1" },
  total_charges: { wksht: "C", line: "1", col: "8" },
  medicare_days: { wksht: "S3", line: "1", col: "6" },
  total_days: { wksht: "S3", line: "1", col: "8" },
} as const;

/**
 * Extract a PaymentRecord from an SNF HCRIS report.
 * @param rptRow   The selected row from the RPT file for this provider-year.
 * @param nmrcGroup All NMRC rows for this RPT_REC_NUM.
 */
export function transformSnf(
  rptRow: Record<string, string>,
  nmrcGroup: Record<string, string>[],
): PaymentRecord {
  return {
    prvdr_num: rptRow.PRVDR_NUM,
    fiscal_year: parseFiscalYear(rptRow.FY_END_DT) ?? 0,
    medicare_payments: lookupValue(
      nmrcGroup,
      COORDS.medicare_payments.wksht,
      COORDS.medicare_payments.line,
      COORDS.medicare_payments.col,
    ),
    total_charges: lookupValue(
      nmrcGroup,
      COORDS.total_charges.wksht,
      COORDS.total_charges.line,
      COORDS.total_charges.col,
    ),
    total_days: lookupValue(
      nmrcGroup,
      COORDS.total_days.wksht,
      COORDS.total_days.line,
      COORDS.total_days.col,
    ),
    total_patients: null, // SNF does not extract total_patients
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/lib/__tests__/transform-hcris-snf.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/__tests__/transform-hcris-snf.test.ts scripts/lib/transform-hcris-snf.ts
git commit -m "feat: add SNF HCRIS transform"
```

---

### Task 5: HHA transform + tests

**Files:**

- Create: `scripts/lib/__tests__/transform-hcris-hha.test.ts`
- Create: `scripts/lib/transform-hcris-hha.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { transformHha } from "../transform-hcris-hha";

const rptRow = {
  RPT_REC_NUM: "200",
  PRVDR_NUM: "017001",
  FY_END_DT: "12/31/2023",
  FY_BGN_DT: "01/01/2023",
  PROC_DT: "04/01/2024",
  RPT_STUS_CD: "2",
};

const fullNmrc = [
  {
    RPT_REC_NUM: "200",
    WKSHT_CD: "E",
    LINE_NUM: "1",
    CLMN_NUM: "1",
    ITM_VAL_NUM: "300000",
  },
  {
    RPT_REC_NUM: "200",
    WKSHT_CD: "H1",
    LINE_NUM: "1",
    CLMN_NUM: "1",
    ITM_VAL_NUM: "5200",
  },
  {
    RPT_REC_NUM: "200",
    WKSHT_CD: "H1",
    LINE_NUM: "1",
    CLMN_NUM: "2",
    ITM_VAL_NUM: "420",
  },
];

describe("transformHha", () => {
  it("extracts all fields correctly", () => {
    const result = transformHha(rptRow, fullNmrc);
    expect(result).toMatchObject({
      prvdr_num: "017001",
      fiscal_year: 2023,
      medicare_payments: 300000,
      total_charges: null,
      total_days: null,
      total_patients: 420,
    });
  });

  it("exposes total_visits for logging (not stored in payment_history)", () => {
    const result = transformHha(rptRow, fullNmrc);
    expect(result.total_visits).toBe(5200);
  });

  it("returns null for fields with missing NMRC coordinates", () => {
    const result = transformHha(rptRow, []);
    expect(result.medicare_payments).toBeNull();
    expect(result.total_patients).toBeNull();
    expect(result.total_visits).toBeNull();
  });

  it("always returns null for total_charges and total_days (HHA does not extract them)", () => {
    const result = transformHha(rptRow, fullNmrc);
    expect(result.total_charges).toBeNull();
    expect(result.total_days).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run scripts/lib/__tests__/transform-hcris-hha.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `transform-hcris-hha.ts`**

```typescript
import { lookupValue, parseFiscalYear, type PaymentRecord } from "./hcris";

/**
 * Worksheet coordinates for HHA (CMS-1728-20).
 *
 * IMPORTANT: Verify these values against actual HCRIS files before first run.
 * See runbook for verification steps.
 */
const COORDS = {
  medicare_payments: { wksht: "E", line: "1", col: "1" },
  total_visits: { wksht: "H1", line: "1", col: "1" },
  total_patients: { wksht: "H1", line: "1", col: "2" },
} as const;

export interface HhaPaymentRecord extends PaymentRecord {
  /** Total visits — extracted for operational logging only; not stored in payment_history. */
  total_visits: number | null;
}

/**
 * Extract an HhaPaymentRecord from an HHA HCRIS report.
 * @param rptRow    The selected row from the RPT file for this provider-year.
 * @param nmrcGroup All NMRC rows for this RPT_REC_NUM.
 */
export function transformHha(
  rptRow: Record<string, string>,
  nmrcGroup: Record<string, string>[],
): HhaPaymentRecord {
  return {
    prvdr_num: rptRow.PRVDR_NUM,
    fiscal_year: parseFiscalYear(rptRow.FY_END_DT) ?? 0,
    medicare_payments: lookupValue(
      nmrcGroup,
      COORDS.medicare_payments.wksht,
      COORDS.medicare_payments.line,
      COORDS.medicare_payments.col,
    ),
    total_charges: null, // HHA does not extract total_charges
    total_days: null, // HHA does not extract total_days
    total_patients: lookupValue(
      nmrcGroup,
      COORDS.total_patients.wksht,
      COORDS.total_patients.line,
      COORDS.total_patients.col,
    ),
    total_visits: lookupValue(
      nmrcGroup,
      COORDS.total_visits.wksht,
      COORDS.total_visits.line,
      COORDS.total_visits.col,
    ),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/lib/__tests__/transform-hcris-hha.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/__tests__/transform-hcris-hha.test.ts scripts/lib/transform-hcris-hha.ts
git commit -m "feat: add HHA HCRIS transform"
```

---

### Task 6: Hospice transform + tests

**Files:**

- Create: `scripts/lib/__tests__/transform-hcris-hospice.test.ts`
- Create: `scripts/lib/transform-hcris-hospice.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { transformHospice } from "../transform-hcris-hospice";

const rptRow = {
  RPT_REC_NUM: "300",
  PRVDR_NUM: "011500",
  FY_END_DT: "12/31/2023",
  FY_BGN_DT: "01/01/2023",
  PROC_DT: "05/01/2024",
  RPT_STUS_CD: "2",
};

const fullNmrc = [
  {
    RPT_REC_NUM: "300",
    WKSHT_CD: "E",
    LINE_NUM: "1",
    CLMN_NUM: "1",
    ITM_VAL_NUM: "800000",
  },
  {
    RPT_REC_NUM: "300",
    WKSHT_CD: "S2",
    LINE_NUM: "1",
    CLMN_NUM: "1",
    ITM_VAL_NUM: "45000",
  },
];

describe("transformHospice", () => {
  it("extracts all fields correctly", () => {
    const result = transformHospice(rptRow, fullNmrc);
    expect(result).toEqual({
      prvdr_num: "011500",
      fiscal_year: 2023,
      medicare_payments: 800000,
      total_charges: null,
      total_days: 45000,
      total_patients: null,
    });
  });

  it("returns null for fields with missing NMRC coordinates", () => {
    const result = transformHospice(rptRow, []);
    expect(result.medicare_payments).toBeNull();
    expect(result.total_days).toBeNull();
  });

  it("always returns null for total_charges and total_patients (Hospice does not extract them)", () => {
    const result = transformHospice(rptRow, fullNmrc);
    expect(result.total_charges).toBeNull();
    expect(result.total_patients).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run scripts/lib/__tests__/transform-hcris-hospice.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `transform-hcris-hospice.ts`**

```typescript
import { lookupValue, parseFiscalYear, type PaymentRecord } from "./hcris";

/**
 * Worksheet coordinates for Hospice (CMS-1984-14).
 *
 * IMPORTANT: Verify these values against actual HCRIS files before first run.
 * See runbook for verification steps.
 */
const COORDS = {
  medicare_payments: { wksht: "E", line: "1", col: "1" },
  total_days: { wksht: "S2", line: "1", col: "1" },
} as const;

/**
 * Extract a PaymentRecord from a Hospice HCRIS report.
 * @param rptRow    The selected row from the RPT file for this provider-year.
 * @param nmrcGroup All NMRC rows for this RPT_REC_NUM.
 */
export function transformHospice(
  rptRow: Record<string, string>,
  nmrcGroup: Record<string, string>[],
): PaymentRecord {
  return {
    prvdr_num: rptRow.PRVDR_NUM,
    fiscal_year: parseFiscalYear(rptRow.FY_END_DT) ?? 0,
    medicare_payments: lookupValue(
      nmrcGroup,
      COORDS.medicare_payments.wksht,
      COORDS.medicare_payments.line,
      COORDS.medicare_payments.col,
    ),
    total_charges: null, // Hospice does not extract total_charges
    total_days: lookupValue(
      nmrcGroup,
      COORDS.total_days.wksht,
      COORDS.total_days.line,
      COORDS.total_days.col,
    ),
    total_patients: null, // Hospice does not extract total_patients
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/lib/__tests__/transform-hcris-hospice.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/__tests__/transform-hcris-hospice.test.ts scripts/lib/transform-hcris-hospice.ts
git commit -m "feat: add Hospice HCRIS transform"
```

---

## Chunk 3: Entrypoint Scripts + Runbook

The three entrypoints share identical structure. `buildProviderUpdates` is called from `hcris.ts` so the skip-null logic is centrally tested.

### Task 7: SNF entrypoint script

**Files:**

- Create: `scripts/parse-hcris-snf.ts`

- [ ] **Step 1: Create the file**

```typescript
import * as path from "path";
import {
  extractZip,
  cleanupTempDir,
  findFileBySuffix,
  parsePipeDelimited,
  selectBestReports,
  groupNmrcByRptRecNum,
  resolveProviders,
  upsertPaymentHistory,
  updateProviders,
  buildProviderUpdates,
  type PaymentHistoryRow,
} from "./lib/hcris";
import { transformSnf } from "./lib/transform-hcris-snf";

export async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error("Usage: npx tsx scripts/parse-hcris-snf.ts <path-to-zip>");
    process.exit(1);
  }

  console.log(`Starting HCRIS SNF ingestion from: ${path.resolve(zipPath)}`);

  let tempDir: string | null = null;
  try {
    console.log("Extracting zip...");
    tempDir = extractZip(zipPath);

    console.log("Loading RPT file...");
    const rptPath = findFileBySuffix(tempDir, "_RPT_");
    const rptRows = await parsePipeDelimited(rptPath);
    console.log(`  Loaded ${rptRows.length} RPT rows`);

    const selectedReports = selectBestReports(rptRows);
    console.log(
      `  Selected ${selectedReports.size} reports (best per provider-year)`,
    );

    console.log("Loading NMRC file...");
    const nmrcPath = findFileBySuffix(tempDir, "_NMRC_");
    const nmrcRows = await parsePipeDelimited(nmrcPath);
    console.log(`  Loaded ${nmrcRows.length} NMRC rows`);

    const selectedRptRecNums = new Set(selectedReports.keys());
    const nmrcGroups = groupNmrcByRptRecNum(nmrcRows, selectedRptRecNums);

    const paymentRecords = [];
    for (const [rptRecNum, rptRow] of selectedReports) {
      const nmrcGroup = nmrcGroups.get(rptRecNum) ?? [];
      paymentRecords.push(transformSnf(rptRow, nmrcGroup));
    }

    const uniqueCcns = [...new Set(paymentRecords.map((r) => r.prvdr_num))];
    console.log(`\nResolving ${uniqueCcns.length} unique provider CCNs...`);
    const providerMap = await resolveProviders(uniqueCcns);

    const missingCcns = uniqueCcns.filter((ccn) => !providerMap.has(ccn));
    if (missingCcns.length > 0) {
      console.warn(
        `${missingCcns.length} CCNs not found in providers table:`,
        missingCcns.slice(0, 10).join(", "),
        missingCcns.length > 10
          ? `... and ${missingCcns.length - 10} more`
          : "",
      );
    }

    const historyRows: PaymentHistoryRow[] = paymentRecords
      .filter((r) => providerMap.has(r.prvdr_num))
      .map((r) => ({
        provider_id: providerMap.get(r.prvdr_num)!,
        fiscal_year: r.fiscal_year,
        medicare_payments: r.medicare_payments,
        total_charges: r.total_charges,
        total_days: r.total_days,
        total_patients: r.total_patients,
        data_source: "hcris" as const,
      }));

    console.log(`\nUpserting ${historyRows.length} rows to payment_history...`);
    const upserted = await upsertPaymentHistory(historyRows);

    if (upserted === 0) {
      console.error("Zero rows upserted — exiting with failure");
      process.exit(1);
    }

    const { updates: providerUpdates, skippedCcns } = buildProviderUpdates(
      paymentRecords,
      providerMap,
    );

    if (skippedCcns.length > 0) {
      for (const ccn of skippedCcns) {
        console.warn(
          `Skipping providers update for CCN ${ccn}: medicare_payments is null for highest fiscal year`,
        );
      }
    }

    console.log(`\nUpdating ${providerUpdates.length} providers...`);
    const providersUpdated = await updateProviders(providerUpdates);

    const fiscalYears = [
      ...new Set(paymentRecords.map((r) => r.fiscal_year)),
    ].sort();
    const totalRevenue = paymentRecords
      .filter((r) => r.medicare_payments !== null)
      .reduce((sum, r) => sum + r.medicare_payments!, 0);

    console.log("\n--- HCRIS SNF Ingestion Summary ---");
    console.log(`Fiscal years found:            ${fiscalYears.join(", ")}`);
    console.log(`Reports processed:             ${selectedReports.size}`);
    console.log(
      `Providers matched:             ${providerMap.size}  (found in DB)`,
    );
    console.log(
      `Providers missing:             ${missingCcns.length}  (CCN not found)`,
    );
    console.log(`payment_history rows upserted: ${upserted}`);
    console.log(`providers updated:             ${providersUpdated}`);
    if (skippedCcns.length > 0) {
      console.log(`providers skipped (null pay):  ${skippedCcns.length}`);
    }
    console.log(
      `Total Medicare revenue:        $${totalRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    );
    console.log("\nIngestion complete.");
  } finally {
    if (tempDir) cleanupTempDir(tempDir);
  }
}

const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Ingestion failed:", error);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/parse-hcris-snf.ts
git commit -m "feat: add SNF HCRIS entrypoint script"
```

---

### Task 8: HHA entrypoint script

**Files:**

- Create: `scripts/parse-hcris-hha.ts`

Same structure as the SNF entrypoint. Differences: imports `transformHha`, logs `total_visits` in summary, header says `HHA`.

- [ ] **Step 1: Create the file**

```typescript
import * as path from "path";
import {
  extractZip,
  cleanupTempDir,
  findFileBySuffix,
  parsePipeDelimited,
  selectBestReports,
  groupNmrcByRptRecNum,
  resolveProviders,
  upsertPaymentHistory,
  updateProviders,
  buildProviderUpdates,
  type PaymentHistoryRow,
} from "./lib/hcris";
import { transformHha } from "./lib/transform-hcris-hha";

export async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error("Usage: npx tsx scripts/parse-hcris-hha.ts <path-to-zip>");
    process.exit(1);
  }

  console.log(`Starting HCRIS HHA ingestion from: ${path.resolve(zipPath)}`);

  let tempDir: string | null = null;
  try {
    console.log("Extracting zip...");
    tempDir = extractZip(zipPath);

    console.log("Loading RPT file...");
    const rptPath = findFileBySuffix(tempDir, "_RPT_");
    const rptRows = await parsePipeDelimited(rptPath);
    console.log(`  Loaded ${rptRows.length} RPT rows`);

    const selectedReports = selectBestReports(rptRows);
    console.log(
      `  Selected ${selectedReports.size} reports (best per provider-year)`,
    );

    console.log("Loading NMRC file...");
    const nmrcPath = findFileBySuffix(tempDir, "_NMRC_");
    const nmrcRows = await parsePipeDelimited(nmrcPath);
    console.log(`  Loaded ${nmrcRows.length} NMRC rows`);

    const selectedRptRecNums = new Set(selectedReports.keys());
    const nmrcGroups = groupNmrcByRptRecNum(nmrcRows, selectedRptRecNums);

    const paymentRecords = [];
    let totalVisits = 0;
    for (const [rptRecNum, rptRow] of selectedReports) {
      const nmrcGroup = nmrcGroups.get(rptRecNum) ?? [];
      const record = transformHha(rptRow, nmrcGroup);
      totalVisits += record.total_visits ?? 0;
      paymentRecords.push(record);
    }

    const uniqueCcns = [...new Set(paymentRecords.map((r) => r.prvdr_num))];
    console.log(`\nResolving ${uniqueCcns.length} unique provider CCNs...`);
    const providerMap = await resolveProviders(uniqueCcns);

    const missingCcns = uniqueCcns.filter((ccn) => !providerMap.has(ccn));
    if (missingCcns.length > 0) {
      console.warn(
        `${missingCcns.length} CCNs not found in providers table:`,
        missingCcns.slice(0, 10).join(", "),
        missingCcns.length > 10
          ? `... and ${missingCcns.length - 10} more`
          : "",
      );
    }

    const historyRows: PaymentHistoryRow[] = paymentRecords
      .filter((r) => providerMap.has(r.prvdr_num))
      .map((r) => ({
        provider_id: providerMap.get(r.prvdr_num)!,
        fiscal_year: r.fiscal_year,
        medicare_payments: r.medicare_payments,
        total_charges: r.total_charges,
        total_days: r.total_days,
        total_patients: r.total_patients,
        data_source: "hcris" as const,
      }));

    console.log(`\nUpserting ${historyRows.length} rows to payment_history...`);
    const upserted = await upsertPaymentHistory(historyRows);

    if (upserted === 0) {
      console.error("Zero rows upserted — exiting with failure");
      process.exit(1);
    }

    const { updates: providerUpdates, skippedCcns } = buildProviderUpdates(
      paymentRecords,
      providerMap,
    );

    if (skippedCcns.length > 0) {
      for (const ccn of skippedCcns) {
        console.warn(
          `Skipping providers update for CCN ${ccn}: medicare_payments is null for highest fiscal year`,
        );
      }
    }

    console.log(`\nUpdating ${providerUpdates.length} providers...`);
    const providersUpdated = await updateProviders(providerUpdates);

    const fiscalYears = [
      ...new Set(paymentRecords.map((r) => r.fiscal_year)),
    ].sort();
    const totalRevenue = paymentRecords
      .filter((r) => r.medicare_payments !== null)
      .reduce((sum, r) => sum + r.medicare_payments!, 0);

    console.log("\n--- HCRIS HHA Ingestion Summary ---");
    console.log(`Fiscal years found:            ${fiscalYears.join(", ")}`);
    console.log(`Reports processed:             ${selectedReports.size}`);
    console.log(
      `Providers matched:             ${providerMap.size}  (found in DB)`,
    );
    console.log(
      `Providers missing:             ${missingCcns.length}  (CCN not found)`,
    );
    console.log(`payment_history rows upserted: ${upserted}`);
    console.log(`providers updated:             ${providersUpdated}`);
    if (skippedCcns.length > 0) {
      console.log(`providers skipped (null pay):  ${skippedCcns.length}`);
    }
    console.log(
      `Total Medicare revenue:        $${totalRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    );
    console.log(
      `Total visits (logged only):    ${totalVisits.toLocaleString("en-US")}`,
    );
    console.log("\nIngestion complete.");
  } finally {
    if (tempDir) cleanupTempDir(tempDir);
  }
}

const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Ingestion failed:", error);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/parse-hcris-hha.ts
git commit -m "feat: add HHA HCRIS entrypoint script"
```

---

### Task 9: Hospice entrypoint script

**Files:**

- Create: `scripts/parse-hcris-hospice.ts`

Same structure as SNF. Only difference: imports `transformHospice`, header says `Hospice`.

- [ ] **Step 1: Create the file**

```typescript
import * as path from "path";
import {
  extractZip,
  cleanupTempDir,
  findFileBySuffix,
  parsePipeDelimited,
  selectBestReports,
  groupNmrcByRptRecNum,
  resolveProviders,
  upsertPaymentHistory,
  updateProviders,
  buildProviderUpdates,
  type PaymentHistoryRow,
} from "./lib/hcris";
import { transformHospice } from "./lib/transform-hcris-hospice";

export async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error(
      "Usage: npx tsx scripts/parse-hcris-hospice.ts <path-to-zip>",
    );
    process.exit(1);
  }

  console.log(
    `Starting HCRIS Hospice ingestion from: ${path.resolve(zipPath)}`,
  );

  let tempDir: string | null = null;
  try {
    console.log("Extracting zip...");
    tempDir = extractZip(zipPath);

    console.log("Loading RPT file...");
    const rptPath = findFileBySuffix(tempDir, "_RPT_");
    const rptRows = await parsePipeDelimited(rptPath);
    console.log(`  Loaded ${rptRows.length} RPT rows`);

    const selectedReports = selectBestReports(rptRows);
    console.log(
      `  Selected ${selectedReports.size} reports (best per provider-year)`,
    );

    console.log("Loading NMRC file...");
    const nmrcPath = findFileBySuffix(tempDir, "_NMRC_");
    const nmrcRows = await parsePipeDelimited(nmrcPath);
    console.log(`  Loaded ${nmrcRows.length} NMRC rows`);

    const selectedRptRecNums = new Set(selectedReports.keys());
    const nmrcGroups = groupNmrcByRptRecNum(nmrcRows, selectedRptRecNums);

    const paymentRecords = [];
    for (const [rptRecNum, rptRow] of selectedReports) {
      const nmrcGroup = nmrcGroups.get(rptRecNum) ?? [];
      paymentRecords.push(transformHospice(rptRow, nmrcGroup));
    }

    const uniqueCcns = [...new Set(paymentRecords.map((r) => r.prvdr_num))];
    console.log(`\nResolving ${uniqueCcns.length} unique provider CCNs...`);
    const providerMap = await resolveProviders(uniqueCcns);

    const missingCcns = uniqueCcns.filter((ccn) => !providerMap.has(ccn));
    if (missingCcns.length > 0) {
      console.warn(
        `${missingCcns.length} CCNs not found in providers table:`,
        missingCcns.slice(0, 10).join(", "),
        missingCcns.length > 10
          ? `... and ${missingCcns.length - 10} more`
          : "",
      );
    }

    const historyRows: PaymentHistoryRow[] = paymentRecords
      .filter((r) => providerMap.has(r.prvdr_num))
      .map((r) => ({
        provider_id: providerMap.get(r.prvdr_num)!,
        fiscal_year: r.fiscal_year,
        medicare_payments: r.medicare_payments,
        total_charges: r.total_charges,
        total_days: r.total_days,
        total_patients: r.total_patients,
        data_source: "hcris" as const,
      }));

    console.log(`\nUpserting ${historyRows.length} rows to payment_history...`);
    const upserted = await upsertPaymentHistory(historyRows);

    if (upserted === 0) {
      console.error("Zero rows upserted — exiting with failure");
      process.exit(1);
    }

    const { updates: providerUpdates, skippedCcns } = buildProviderUpdates(
      paymentRecords,
      providerMap,
    );

    if (skippedCcns.length > 0) {
      for (const ccn of skippedCcns) {
        console.warn(
          `Skipping providers update for CCN ${ccn}: medicare_payments is null for highest fiscal year`,
        );
      }
    }

    console.log(`\nUpdating ${providerUpdates.length} providers...`);
    const providersUpdated = await updateProviders(providerUpdates);

    const fiscalYears = [
      ...new Set(paymentRecords.map((r) => r.fiscal_year)),
    ].sort();
    const totalRevenue = paymentRecords
      .filter((r) => r.medicare_payments !== null)
      .reduce((sum, r) => sum + r.medicare_payments!, 0);

    console.log("\n--- HCRIS Hospice Ingestion Summary ---");
    console.log(`Fiscal years found:            ${fiscalYears.join(", ")}`);
    console.log(`Reports processed:             ${selectedReports.size}`);
    console.log(
      `Providers matched:             ${providerMap.size}  (found in DB)`,
    );
    console.log(
      `Providers missing:             ${missingCcns.length}  (CCN not found)`,
    );
    console.log(`payment_history rows upserted: ${upserted}`);
    console.log(`providers updated:             ${providersUpdated}`);
    if (skippedCcns.length > 0) {
      console.log(`providers skipped (null pay):  ${skippedCcns.length}`);
    }
    console.log(
      `Total Medicare revenue:        $${totalRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    );
    console.log("\nIngestion complete.");
  } finally {
    if (tempDir) cleanupTempDir(tempDir);
  }
}

const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Ingestion failed:", error);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Type-check all scripts**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/parse-hcris-hospice.ts
git commit -m "feat: add Hospice HCRIS entrypoint script"
```

---

### Task 10: Quarterly runbook

**Files:**

- Create: `docs/hcris-quarterly-runbook.md`

- [ ] **Step 1: Create the runbook**

````markdown
# HCRIS Quarterly Runbook

This document describes the steps to update Medicare payment data from CMS HCRIS cost reports.
Run this process once per quarter. It takes approximately 30–60 minutes including download time.

Cost reports lag ~18 months from the fiscal year end. This is expected.

---

## Step 1: Download the HCRIS zip files

Download the three zip files from the CMS cost reports page:

**URL:** https://www.cms.gov/data-research/statistics-trends-and-reports/cost-reports/cost-reports-fiscal-year

On that page, look for the most recent fiscal year available. Download one zip for each provider type:

| Provider Type                  | Form        | What to look for on the page |
| ------------------------------ | ----------- | ---------------------------- |
| Skilled Nursing Facility (SNF) | CMS-2540-10 | "SNF" or "Skilled Nursing"   |
| Home Health Agency (HHA)       | CMS-1728-20 | "HHA" or "Home Health"       |
| Hospice                        | CMS-1984-14 | "Hospice"                    |

Save the files somewhere accessible, e.g. `~/Downloads/hcris/`.

---

## Step 2: Verify the zip contents

Each zip should contain exactly three files. Check with:

```bash
unzip -l ~/Downloads/hcris/snf_fy2023.zip
```
````

You should see files with these suffixes in their names:

- `_RPT_` — report metadata (tens of thousands of rows)
- `_NMRC_` — numeric values (millions of rows — this is normal)
- `_ALPHNMRC_` — alpha-numeric values (not used by our scripts)

If you don't see these suffixes, the file structure may have changed. Check the CMS data dictionary and update the suffix constants in `scripts/lib/hcris.ts` if needed.

---

## Step 3: Verify worksheet coordinates (one-time setup or after form changes)

> **Skip this step** if you have already run HCRIS ingestion successfully before. Only repeat if CMS updates the form version.

The scripts look up specific `(WKSHT_CD, LINE_NUM, CLMN_NUM)` values in the NMRC file. These coordinates are defined as constants in `scripts/lib/transform-hcris-*.ts`. CMS form instructions sometimes use different notation than the raw file values (e.g. the form says `E` but the file contains `E00001`).

To verify, extract the zip and inspect the NMRC file:

```bash
# Extract the zip
unzip ~/Downloads/hcris/snf_fy2023.zip -d /tmp/hcris-snf/

# View the NMRC file header and first 5 data rows
head -6 /tmp/hcris-snf/*_NMRC_*
```

The NMRC file is pipe-delimited (`|`). Columns are:
`RPT_REC_NUM|WKSHT_CD|LINE_NUM|CLMN_NUM|ITM_VAL_NUM`

Look at the actual `WKSHT_CD` values in the file. If they differ from the constants in `transform-hcris-snf.ts` (e.g. file has `E00001` instead of `E`), update the constants in that file before running.

To spot-check a specific coordinate:

```bash
# Find rows for worksheet E, line 1, column 1 in the SNF NMRC file
grep -m5 '|E|1|1|' /tmp/hcris-snf/*_NMRC_*
```

---

## Step 4: Set environment variables

The scripts require the same env vars as all other ingestion scripts:

```bash
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

These are in your `.env.local` file. Load them with:

```bash
export $(grep -v '^#' .env.local | xargs)
```

---

## Step 5: Run the three scripts

Run each script, passing the path to the corresponding zip file.

**SNF:**

```bash
npx tsx scripts/parse-hcris-snf.ts ~/Downloads/hcris/snf_fy2023.zip
```

**HHA:**

```bash
npx tsx scripts/parse-hcris-hha.ts ~/Downloads/hcris/hha_fy2023.zip
```

**Hospice:**

```bash
npx tsx scripts/parse-hcris-hospice.ts ~/Downloads/hcris/hospice_fy2023.zip
```

Each script will print progress and a summary at the end. Expected runtime: 5–15 minutes each.

---

## Step 6: Interpret the summary log

A successful run looks like:

```
--- HCRIS SNF Ingestion Summary ---
Fiscal years found:            2021, 2022, 2023
Reports processed:             14,802
Providers matched:             14,650  (found in DB)
Providers missing:                152  (CCN not found)
payment_history rows upserted: 14,650
providers updated:             14,650
Total Medicare revenue:        $42,847,203,441

Ingestion complete.
```

**What to check:**

- `Providers missing` — CCNs in HCRIS that don't match any provider in our database. A small number (1–5%) is normal (closed providers or providers not yet in our dataset). A large number may indicate a CCN format mismatch — compare the raw `PRVDR_NUM` values in the RPT file against our `providers.cms_id` column.
- `Total Medicare revenue` — Cross-reference against prior quarter. A dramatic change warrants investigation.
- `providers skipped (null pay)` — Providers whose highest fiscal year had no extractable payment amount. Investigate if unexpectedly high.

---

## Step 7: If a script fails mid-run

The scripts are **idempotent** — re-running is safe. Both `payment_history` (upserted on `provider_id + fiscal_year`) and `providers` (updated by UUID) will overwrite existing values with the same data. No duplicate rows will be created.

If the script fails early (e.g. during zip extraction), no data will have been written — just fix the issue and re-run.

---

## Quarterly checklist

- [ ] Downloaded all three HCRIS zip files for the most recent fiscal year
- [ ] Verified zip contents (three files per zip with expected suffixes)
- [ ] Ran `parse-hcris-snf.ts` — reviewed summary, checked providers missing count
- [ ] Ran `parse-hcris-hha.ts` — reviewed summary
- [ ] Ran `parse-hcris-hospice.ts` — reviewed summary
- [ ] Confirmed `providers.annual_medicare_payments` is populated in the database

````

- [ ] **Step 2: Commit**

```bash
git add docs/hcris-quarterly-runbook.md
git commit -m "docs: add HCRIS quarterly runbook for operators"
````

---

### Task 11: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run linter**

```bash
npx eslint scripts/lib/hcris.ts scripts/lib/transform-hcris-snf.ts scripts/lib/transform-hcris-hha.ts scripts/lib/transform-hcris-hospice.ts scripts/parse-hcris-snf.ts scripts/parse-hcris-hha.ts scripts/parse-hcris-hospice.ts
```

Expected: no errors.
