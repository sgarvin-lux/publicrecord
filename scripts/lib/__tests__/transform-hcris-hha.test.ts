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
  { RPT_REC_NUM: "200", WKSHT_CD: "E",  LINE_NUM: "1", CLMN_NUM: "1", ITM_VAL_NUM: "300000" },
  { RPT_REC_NUM: "200", WKSHT_CD: "H1", LINE_NUM: "1", CLMN_NUM: "1", ITM_VAL_NUM: "5200" },
  { RPT_REC_NUM: "200", WKSHT_CD: "H1", LINE_NUM: "1", CLMN_NUM: "2", ITM_VAL_NUM: "420" },
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
