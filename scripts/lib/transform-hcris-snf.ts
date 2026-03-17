import { lookupValue, parseFiscalYear, type PaymentRecord } from "./hcris";

/**
 * Worksheet coordinates for SNF.
 *
 * CMS introduced a new form version (CMS-2540-24) for cost reporting periods
 * starting on or after ~2023. Both forms are in circulation:
 *   - CMS-2540-24 ("SNF24"): E00A18A/01400, C000000/02500 col 00100
 *   - CMS-2540-10 ("SNF10"): E00A181/00300, C000000/10000 col 00200
 *
 * transformSnf tries the new-form coordinate first and falls back to the old.
 * total_days (S300001/00100/00200) is identical across both form versions.
 */
const COORDS = {
  medicare_payments_new: { wksht: "E00A18A", line: "01400", col: "00100" },
  medicare_payments_old: { wksht: "E00A181", line: "00300", col: "00100" },
  total_charges_new: { wksht: "C000000", line: "02500", col: "00100" },
  total_charges_old: { wksht: "C000000", line: "10000", col: "00200" },
  total_days: { wksht: "S300001", line: "00100", col: "00200" },
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
    medicare_payments:
      lookupValue(
        nmrcGroup,
        COORDS.medicare_payments_new.wksht,
        COORDS.medicare_payments_new.line,
        COORDS.medicare_payments_new.col,
      ) ??
      lookupValue(
        nmrcGroup,
        COORDS.medicare_payments_old.wksht,
        COORDS.medicare_payments_old.line,
        COORDS.medicare_payments_old.col,
      ),
    total_charges:
      lookupValue(
        nmrcGroup,
        COORDS.total_charges_new.wksht,
        COORDS.total_charges_new.line,
        COORDS.total_charges_new.col,
      ) ??
      lookupValue(
        nmrcGroup,
        COORDS.total_charges_old.wksht,
        COORDS.total_charges_old.line,
        COORDS.total_charges_old.col,
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
