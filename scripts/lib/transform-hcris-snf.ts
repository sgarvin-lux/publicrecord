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
  total_charges:     { wksht: "C", line: "1", col: "8" },
  medicare_days:     { wksht: "S3", line: "1", col: "6" },
  total_days:        { wksht: "S3", line: "1", col: "8" },
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
