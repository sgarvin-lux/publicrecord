import { lookupValue, parseFiscalYear, type PaymentRecord } from "./hcris";

/**
 * Worksheet coordinates for Hospice (CMS-1984-14).
 *
 * IMPORTANT: Verify these values against actual HCRIS files before first run.
 * See runbook for verification steps.
 */
const COORDS = {
  medicare_payments: { wksht: "E",  line: "1", col: "1" },
  total_days:        { wksht: "S2", line: "1", col: "1" },
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
