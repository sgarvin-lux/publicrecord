import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hcris-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns the full path of the matching file (case-insensitive suffix)", () => {
    fs.writeFileSync(path.join(tempDir, "SNF_2023_RPT_ABC.csv"), "");
    fs.writeFileSync(path.join(tempDir, "SNF_2023_NMRC_DEF.csv"), "");
    const result = findFileBySuffix(tempDir, "_rpt_");
    expect(result).toBe(path.join(tempDir, "SNF_2023_RPT_ABC.csv"));
  });

  it("throws when no file matches the suffix", () => {
    fs.writeFileSync(path.join(tempDir, "SNF_2023_NMRC_DEF.csv"), "");
    expect(() => findFileBySuffix(tempDir, "_RPT_")).toThrow(
      `No file with suffix "_RPT_" found in ${tempDir}`,
    );
  });
});

// ─── selectBestReports ────────────────────────────────────────────────────

describe("selectBestReports", () => {
  it("prefers settled (status 2) over as-submitted (status 1) for same provider-year", () => {
    const rows = [
      { RPT_REC_NUM: "100", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "1" },
      { RPT_REC_NUM: "101", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "2" },
    ];
    const result = selectBestReports(rows);
    expect(result.has("101")).toBe(true);
    expect(result.has("100")).toBe(false);
  });

  it("prefers amended/settled (status 4) over as-submitted (status 1)", () => {
    const rows = [
      { RPT_REC_NUM: "200", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "1" },
      { RPT_REC_NUM: "201", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "4" },
    ];
    const result = selectBestReports(rows);
    expect(result.has("201")).toBe(true);
    expect(result.has("200")).toBe(false);
  });

  it("treats status 2 and status 4 as equal priority, breaking ties by PROC_DT", () => {
    const rows = [
      { RPT_REC_NUM: "300", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "2" },
      { RPT_REC_NUM: "301", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "06/01/2024", RPT_STUS_CD: "4" },
    ];
    const result = selectBestReports(rows);
    // status 2 and 4 are equal priority; 301 has more recent PROC_DT
    expect(result.has("301")).toBe(true);
    expect(result.has("300")).toBe(false);
  });

  it("prefers most recent PROC_DT when status is equal", () => {
    const rows = [
      { RPT_REC_NUM: "400", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "01/15/2024", RPT_STUS_CD: "2" },
      { RPT_REC_NUM: "401", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "06/01/2024", RPT_STUS_CD: "2" },
    ];
    const result = selectBestReports(rows);
    expect(result.has("401")).toBe(true);
    expect(result.has("400")).toBe(false);
  });

  it("selects the only report even when status=1 (as-submitted) only", () => {
    const rows = [
      { RPT_REC_NUM: "500", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "1" },
    ];
    const result = selectBestReports(rows);
    expect(result.has("500")).toBe(true);
  });

  it("logs a warning and picks last-seen when status and PROC_DT are both equal (degenerate case)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = [
      { RPT_REC_NUM: "600", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "2" },
      { RPT_REC_NUM: "601", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "2" },
    ];
    const result = selectBestReports(rows);
    expect(result.has("601")).toBe(true); // last-seen wins
    expect(result.has("600")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("012345"));
    warnSpy.mockRestore();
  });

  it("handles multiple providers independently", () => {
    const rows = [
      { RPT_REC_NUM: "700", PRVDR_NUM: "111111", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "2" },
      { RPT_REC_NUM: "701", PRVDR_NUM: "222222", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "1" },
    ];
    const result = selectBestReports(rows);
    expect(result.size).toBe(2);
  });

  it("handles multiple fiscal years for the same provider independently", () => {
    const rows = [
      { RPT_REC_NUM: "800", PRVDR_NUM: "012345", FY_END_DT: "12/31/2022", PROC_DT: "03/01/2023", RPT_STUS_CD: "2" },
      { RPT_REC_NUM: "801", PRVDR_NUM: "012345", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "2" },
    ];
    const result = selectBestReports(rows);
    expect(result.size).toBe(2);
  });

  it("skips rows with missing PRVDR_NUM or unparseable FY_END_DT", () => {
    const rows = [
      { RPT_REC_NUM: "900", PRVDR_NUM: "", FY_END_DT: "12/31/2023", PROC_DT: "03/01/2024", RPT_STUS_CD: "2" },
      { RPT_REC_NUM: "901", PRVDR_NUM: "012345", FY_END_DT: "2023-12-31", PROC_DT: "03/01/2024", RPT_STUS_CD: "2" },
    ];
    const result = selectBestReports(rows);
    expect(result.size).toBe(0);
  });
});

// ─── groupNmrcByRptRecNum ─────────────────────────────────────────────────

describe("groupNmrcByRptRecNum", () => {
  it("groups NMRC rows by RPT_REC_NUM, filtering to selected set", () => {
    const nmrcRows = [
      { RPT_REC_NUM: "100", WKSHT_CD: "E", LINE_NUM: "1", CLMN_NUM: "1", ITM_VAL_NUM: "500000" },
      { RPT_REC_NUM: "100", WKSHT_CD: "C", LINE_NUM: "1", CLMN_NUM: "8", ITM_VAL_NUM: "750000" },
      { RPT_REC_NUM: "999", WKSHT_CD: "E", LINE_NUM: "1", CLMN_NUM: "1", ITM_VAL_NUM: "100000" },
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
    { RPT_REC_NUM: "100", WKSHT_CD: "E", LINE_NUM: "1", CLMN_NUM: "1", ITM_VAL_NUM: "500000.50" },
    { RPT_REC_NUM: "100", WKSHT_CD: "C", LINE_NUM: "1", CLMN_NUM: "8", ITM_VAL_NUM: "750000" },
  ];

  it("returns the numeric value for a matching coordinate", () => {
    expect(lookupValue(nmrcGroup, "E", "1", "1")).toBe(500000.5);
  });

  it("returns null when coordinate is not found", () => {
    expect(lookupValue(nmrcGroup, "S3", "1", "6")).toBeNull();
  });

  it("returns null for non-numeric ITM_VAL_NUM", () => {
    const group = [{ RPT_REC_NUM: "100", WKSHT_CD: "E", LINE_NUM: "1", CLMN_NUM: "1", ITM_VAL_NUM: "N/A" }];
    expect(lookupValue(group, "E", "1", "1")).toBeNull();
  });

  it("matches coordinates that have been whitespace-trimmed", () => {
    // HCRIS pipe-delimited files often have padded fields; parsePipeDelimited trims them
    const group = [{ RPT_REC_NUM: "100", WKSHT_CD: "E", LINE_NUM: "1", CLMN_NUM: "1", ITM_VAL_NUM: "  99999  " }];
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
      { prvdr_num: "012345", fiscal_year: 2022, medicare_payments: 400000, total_charges: 600000, total_days: 10000, total_patients: null },
      { prvdr_num: "012345", fiscal_year: 2023, medicare_payments: 500000, total_charges: 750000, total_days: 11000, total_patients: null },
    ];
    const { updates } = buildProviderUpdates(records, providerMap);
    expect(updates).toHaveLength(1);
    expect(updates[0].payment_data_year).toBe(2023);
    expect(updates[0].annual_medicare_payments).toBe(500000);
  });

  it("skips providers whose highest fiscal year has null medicare_payments", () => {
    const records = [
      { prvdr_num: "012345", fiscal_year: 2023, medicare_payments: null, total_charges: null, total_days: null, total_patients: null },
    ];
    const { updates, skippedCcns } = buildProviderUpdates(records, providerMap);
    expect(updates).toHaveLength(0);
    expect(skippedCcns).toContain("012345");
  });

  it("skips CCNs that are not in providerMap (already counted as missing)", () => {
    const records = [
      { prvdr_num: "999999", fiscal_year: 2023, medicare_payments: 100000, total_charges: null, total_days: null, total_patients: null },
    ];
    const { updates } = buildProviderUpdates(records, providerMap);
    expect(updates).toHaveLength(0);
  });

  it("computes charge_to_payment_ratio correctly", () => {
    const records = [
      { prvdr_num: "012345", fiscal_year: 2023, medicare_payments: 500000, total_charges: 750000, total_days: null, total_patients: null },
    ];
    const { updates } = buildProviderUpdates(records, providerMap);
    expect(updates[0].charge_to_payment_ratio).toBe(1.5);
  });

  it("sets charge_to_payment_ratio to null when total_charges is null (HHA/Hospice)", () => {
    const records = [
      { prvdr_num: "012345", fiscal_year: 2023, medicare_payments: 500000, total_charges: null, total_days: null, total_patients: null },
    ];
    const { updates } = buildProviderUpdates(records, providerMap);
    expect(updates[0].charge_to_payment_ratio).toBeNull();
  });

  it("sets data_source to 'hcris'", () => {
    const records = [
      { prvdr_num: "012345", fiscal_year: 2023, medicare_payments: 500000, total_charges: null, total_days: null, total_patients: null },
    ];
    const { updates } = buildProviderUpdates(records, providerMap);
    expect(updates[0].payment_data_source).toBe("hcris");
  });
});
