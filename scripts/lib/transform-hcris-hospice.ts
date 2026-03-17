import { lookupValue, parseFiscalYear, type PaymentRecord } from "./hcris";

/**
 * Worksheet coordinates for Hospice (CMS-1984-14).
 *
 * IMPORTANT: Verify these coordinates against actual data before first run.
 * Use: grep ',B000000,10100,03A00,' your_nmrc_file.csv | head -5
 * to confirm the value matches expected Medicare payments.
 */
const COORDS = {
  medicare_payments: { wksht: "B000000", line: "10100", col: "03A00" },
  total_days:        { wksht: "S100000", line: "03100", col: "00100" },
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
    total_charges: null,  // Hospice does not extract total_charges
    total_days: lookupValue(
      nmrcGroup,
      COORDS.total_days.wksht,
      COORDS.total_days.line,
      COORDS.total_days.col,
    ),
    total_patients: null, // Hospice does not extract total_patients
  };
}
