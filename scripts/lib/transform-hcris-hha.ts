import { lookupValue, parseFiscalYear, type PaymentRecord } from "./hcris";

/**
 * Worksheet coordinates for HHA (CMS-1728-20).
 *
 * IMPORTANT: Verify these values against actual HCRIS files before first run.
 * See runbook for verification steps.
 */
const COORDS = {
  medicare_payments: { wksht: "E",  line: "1", col: "1" },
  total_visits:      { wksht: "H1", line: "1", col: "1" },
  total_patients:    { wksht: "H1", line: "1", col: "2" },
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
