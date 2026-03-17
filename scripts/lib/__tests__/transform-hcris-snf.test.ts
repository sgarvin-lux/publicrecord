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
  { RPT_REC_NUM: "100", WKSHT_CD: "E", LINE_NUM: "1", CLMN_NUM: "1", ITM_VAL_NUM: "500000" },
  { RPT_REC_NUM: "100", WKSHT_CD: "C", LINE_NUM: "1", CLMN_NUM: "8", ITM_VAL_NUM: "750000" },
  { RPT_REC_NUM: "100", WKSHT_CD: "S3", LINE_NUM: "1", CLMN_NUM: "6", ITM_VAL_NUM: "8500" },
  { RPT_REC_NUM: "100", WKSHT_CD: "S3", LINE_NUM: "1", CLMN_NUM: "8", ITM_VAL_NUM: "12000" },
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
      { RPT_REC_NUM: "100", WKSHT_CD: "E", LINE_NUM: "1", CLMN_NUM: "1", ITM_VAL_NUM: "500000.75" },
    ];
    const result = transformSnf(rptRow, nmrc);
    expect(result.medicare_payments).toBe(500000.75);
  });
});
