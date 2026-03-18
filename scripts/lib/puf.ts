import { createInterface } from "readline";
import { Readable } from "stream";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import { computeChargeToPaymentRatio, resolveProviders } from "./hcris";

// Lazy import to avoid throwing at module load time in test environments
// where SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.
let _supabaseAdmin: SupabaseClient<Database> | undefined;
async function getSupabaseAdmin(): Promise<SupabaseClient<Database>> {
  if (!_supabaseAdmin) {
    const mod = await import("./supabase-admin");
    _supabaseAdmin = mod.supabaseAdmin;
  }
  return _supabaseAdmin;
}

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

// ─── CSV Fetching ──────────────────────────────────────────────────────────

/**
 * Fetch a PUF CSV from a URL and parse it into row objects.
 * Streams the response body through readline line by line.
 * Returns all rows — caller filters by SMRY_CTGRY.
 *
 * Uses naive comma splitting (no RFC 4180 quoting support). This is correct
 * for CMS PUF files: the fields we read (PRVDR_ID, YEAR, TOT_MDCR_PYMT_AMT,
 * TOT_CHRG_AMT, TOT_SRVC_DAYS, BENE_DSTNCT_CNT) are all numeric or coded
 * values that never contain commas.
 */
export async function fetchAndParsePufCsv(
  url: string,
): Promise<Record<string, string>[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch PUF CSV from ${url}: ${response.status} ${response.statusText}`,
    );
  }
  if (!response.body) throw new Error(`No response body from ${url}`);

  const nodeStream = Readable.fromWeb(
    response.body as import("stream/web").ReadableStream,
  );
  const rl = createInterface({ input: nodeStream, crlfDelay: Infinity });

  let headers: string[] = [];
  const rows: Record<string, string>[] = [];
  let isFirst = true;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isFirst) {
      headers = trimmed.split(",").map((h) => h.trim());
      isFirst = false;
      continue;
    }
    const cols = trimmed.split(",");
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cols[j] ?? "").trim();
    }
    rows.push(row);
  }

  return rows;
}

// ─── Supabase Helpers ──────────────────────────────────────────────────────

const BATCH_SIZE = 500;
const CONCURRENT = 50;

/**
 * Insert PUF payment_history rows in batches of 500.
 * Uses ignoreDuplicates: true (ON CONFLICT DO NOTHING) so existing HCRIS
 * rows are never overwritten.
 *
 * DO NOT change to the default upsert behavior — that would overwrite HCRIS.
 */
export async function upsertPufPaymentHistory(
  rows: PufPaymentHistoryRow[],
): Promise<number> {
  const supabaseAdmin = await getSupabaseAdmin();
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabaseAdmin
      .from("payment_history")
      .upsert(batch, {
        onConflict: "provider_id,fiscal_year",
        ignoreDuplicates: true, // DO NOTHING — preserves HCRIS rows
        count: "exact",
      });
    if (error) throw new Error(`PUF upsert failed: ${error.message}`);
    total += count ?? 0;
    console.log(
      `  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${count ?? 0} rows`,
    );
  }
  return total;
}

/**
 * Update providers.annual_medicare_payments (and related fields) from PUF data.
 * The .is("payment_data_source", null) guard is the primary correctness check:
 * providers already sourced from HCRIS are never updated. DO NOT remove it.
 */
export async function updateProvidersFromPuf(
  updates: PufProviderUpdate[],
): Promise<number> {
  const supabaseAdmin = await getSupabaseAdmin();
  let total = 0;
  for (let i = 0; i < updates.length; i += CONCURRENT) {
    const batch = updates.slice(i, i + CONCURRENT);
    const counts = await Promise.all(
      batch.map(async (u) => {
        const { error, count } = await supabaseAdmin
          .from("providers")
          .update(
            {
              annual_medicare_payments: u.annual_medicare_payments,
              payment_data_year: u.payment_data_year,
              payment_data_source: u.payment_data_source,
              charge_to_payment_ratio: u.charge_to_payment_ratio,
            },
            { count: "exact" },
          )
          .eq("id", u.provider_id)
          .is("payment_data_source", null); // primary guard — DO NOT remove
        if (error) throw new Error(`Provider update failed: ${error.message}`);
        return count ?? 0;
      }),
    );
    total += counts.reduce((sum, c) => sum + c, 0);
  }
  return total;
}
