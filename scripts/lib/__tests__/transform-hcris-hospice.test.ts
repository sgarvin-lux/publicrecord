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
    WKSHT_CD: "B000000",
    LINE_NUM: "10100",
    CLMN_NUM: "03A00",
    ITM_VAL_NUM: "800000",
  },
  {
    RPT_REC_NUM: "300",
    WKSHT_CD: "S100000",
    LINE_NUM: "03100",
    CLMN_NUM: "00100",
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
