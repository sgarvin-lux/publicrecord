import { computeChargeToPaymentRatio } from "./hcris";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PufPaymentHistoryRow {
  provider_id: string;
  fiscal_year: number;
  medicare_payments: number | null;
  total_charges: number | null;
  total_days: number | null;
  total_patients: number | null;
  data_source: "utilization_puf";
}

export interface PufProviderUpdate {
  provider_id: string;
  annual_medicare_payments: number;
  payment_data_year: number;
  payment_data_source: "utilization_puf";
  charge_to_payment_ratio: number | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse a CMS PUF numeric field to number | null.
 * Returns null for suppressed values ("*"), empty strings, and non-numerics.
 */
export function parseAmount(value: string | undefined): number | null {
  if (!value || value.trim() === "" || value.trim() === "*") return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

// ─── Transform ─────────────────────────────────────────────────────────────

/**
 * Filter and map raw PUF CSV rows to PufPaymentHistoryRow records.
 * Skips non-PROVIDER summary rows and rows whose CCN is not in the lookup.
 */
export function transformPufRows(
  rows: Record<string, string>[],
  lookup: Map<string, string>,
): PufPaymentHistoryRow[] {
  const result: PufPaymentHistoryRow[] = [];
  for (const row of rows) {
    if (row.SMRY_CTGRY !== "PROVIDER") continue;
    const ccn = row.PRVDR_ID?.trim() ?? "";
    const providerId = lookup.get(ccn);
    if (!providerId) continue;
    result.push({
      provider_id: providerId,
      fiscal_year: parseInt(row.YEAR ?? "0", 10),
      medicare_payments: parseAmount(row.TOT_MDCR_PYMT_AMT),
      total_charges: parseAmount(row.TOT_CHRG_AMT),
      total_days: parseAmount(row.TOT_SRVC_DAYS),
      total_patients: parseAmount(row.BENE_DSTNCT_CNT),
      data_source: "utilization_puf",
    });
  }
  return result;
}

// ─── Provider Update Builder ───────────────────────────────────────────────

/**
 * Build provider update records from PUF rows for providers that have no
 * existing payment_data_source (i.e. no HCRIS data).
 *
 * When a provider has rows from multiple PUF datasets, the highest fiscal_year
 * wins. Skips providers whose medicare_payments is null.
 *
 * @param rows             All PufPaymentHistoryRow records across all datasets.
 * @param currentDataSources Map<provider_id, payment_data_source | null>
 *                           from the providers table.
 */
export function buildPufProviderUpdates(
  rows: PufPaymentHistoryRow[],
  currentDataSources: Map<string, string | null>,
): PufProviderUpdate[] {
  // Pre-filter: skip providers already sourced from HCRIS or elsewhere.
  // The DB-side .is("payment_data_source", null) guard is the authoritative
  // correctness check — this is an optimization to skip no-op updates.
  const latestByProvider = new Map<string, PufPaymentHistoryRow>();
  for (const row of rows) {
    const existingSource = currentDataSources.get(row.provider_id);
    if (existingSource !== null && existingSource !== undefined) continue;
    const current = latestByProvider.get(row.provider_id);
    if (!current || row.fiscal_year > current.fiscal_year) {
      latestByProvider.set(row.provider_id, row);
    }
  }

  const updates: PufProviderUpdate[] = [];
  for (const row of latestByProvider.values()) {
    if (row.medicare_payments === null) continue;
    updates.push({
      provider_id: row.provider_id,
      annual_medicare_payments: row.medicare_payments,
      payment_data_year: row.fiscal_year,
      payment_data_source: "utilization_puf",
      charge_to_payment_ratio: computeChargeToPaymentRatio(
        row.total_charges,
        row.medicare_payments,
      ),
    });
  }
  return updates;
}
