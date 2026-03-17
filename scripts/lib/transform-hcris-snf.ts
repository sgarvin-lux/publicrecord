import { lookupValue, parseFiscalYear, type PaymentRecord } from "./hcris";

/**
 * Worksheet coordinates for SNF (CMS-2540-10).
 *
 * IMPORTANT: Verify these coordinates against actual data before first run.
 * Use: grep ',E00A18A,01400,00100,' your_nmrc_file.csv | head -5
 * to confirm the value matches expected Medicare Part A net reimbursement.
 */
const COORDS = {
  medicare_payments: { wksht: "E00A18A", line: "01400", col: "00100" },
  total_charges:     { wksht: "C000000", line: "02500", col: "00100" },
  total_days:        { wksht: "S300001", line: "00100", col: "00200" },
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
