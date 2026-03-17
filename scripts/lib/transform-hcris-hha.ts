import { lookupValue, parseFiscalYear, type PaymentRecord } from "./hcris";

/**
 * Worksheet coordinates for HHA (CMS-1728-20).
 *
 * IMPORTANT: Verify these coordinates against actual data before first run.
 * Use: grep ',B000000,10000,01000,' your_nmrc_file.csv | head -5
 * to confirm the value matches expected Medicare payments.
 */
const COORDS = {
  medicare_payments: { wksht: "B000000", line: "10000", col: "01000" },
  total_visits:      { wksht: "S300004", line: "00200", col: "00500" },
  total_patients:    { wksht: "S300004", line: "00100", col: "00500" },
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
    total_days: null,    // HHA does not extract total_days
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
