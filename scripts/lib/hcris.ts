import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

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

export interface PaymentRecord {
  prvdr_num: string;
  fiscal_year: number;
  medicare_payments: number | null;
  total_charges: number | null; // SNF only; null for HHA and Hospice
  total_days: number | null;
  total_patients: number | null; // HHA only; null for SNF and Hospice
}

export interface PaymentHistoryRow {
  provider_id: string;
  fiscal_year: number;
  medicare_payments: number | null;
  total_charges: number | null;
  total_days: number | null;
  total_patients: number | null;
  data_source: "hcris";
}

export interface ProviderUpdate {
  provider_id: string;
  annual_medicare_payments: number;
  payment_data_year: number;
  payment_data_source: "hcris";
  charge_to_payment_ratio: number | null;
}

// ─── File Utilities ────────────────────────────────────────────────────────

/**
 * Column names for RPT file (comma-delimited, no header, positional).
 * Standard HCRIS cost report RPT file format.
 */
export const RPT_COLS = [
  "RPT_REC_NUM", "PRVDR_CTRL_TYPE_CD", "PRVDR_NUM", "NPI",
  "RPT_STUS_CD", "FY_BGN_DT", "FY_END_DT", "PROC_DT",
  "INITL_RPT_SW", "LAST_RPT_SW", "TRNSMTL_NUM", "FI_NUM",
  "ADR_VNDR_CD", "FI_CREAT_DT", "UTIL_CD", "NPR_DT",
  "SPEC_IND", "INITL_RPT_DT",
] as const;

/**
 * Column names for NMRC file (comma-delimited, no header, positional).
 * Standard HCRIS cost report NMRC file format.
 */
export const NMRC_COLS = [
  "RPT_REC_NUM", "WKSHT_CD", "LINE_NUM", "CLMN_NUM", "ITM_VAL_NUM",
] as const;

/**
 * Parse an HCRIS CSV file (no header row, comma-delimited, latin1 encoding).
 * Maps each row's positional fields to the provided column names.
 */
export async function parseHcrisFile(
  filePath: string,
  colNames: readonly string[],
): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = line.split(",");
    const row: Record<string, string> = {};
    for (let i = 0; i < colNames.length; i++) {
      row[colNames[i]] = (cols[i] ?? "").trim();
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Find all RPT/NMRC file pairs in a directory.
 * Matches files ending in `_rpt.csv` with their corresponding `_nmrc.csv` file.
 * Returns pairs sorted by filename (i.e. by year for standard HCRIS naming).
 */
export function findRptNmrcPairs(
  dir: string,
): Array<{ rpt: string; nmrc: string }> {
  const files = fs.readdirSync(dir);
  const rptFiles = files.filter((f) => /_rpt\.csv$/i.test(f)).sort();

  const pairs: Array<{ rpt: string; nmrc: string }> = [];
  for (const rptFile of rptFiles) {
    const nmrcFile = rptFile.replace(/_rpt\.csv$/i, "_nmrc.csv");
    if (files.includes(nmrcFile)) {
      pairs.push({
        rpt: path.join(dir, rptFile),
        nmrc: path.join(dir, nmrcFile),
      });
    }
  }
  return pairs;
}

// ─── Report Selection ──────────────────────────────────────────────────────

/**
 * Derives the fiscal year (integer) from the FY_END_DT field (MM/DD/YYYY).
 * Returns null if the date is missing or malformed.
 */
export function parseFiscalYear(fyEndDt: string): number | null {
  if (!fyEndDt) return null;
  const parts = fyEndDt.trim().split("/");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[2], 10);
  return isNaN(year) ? null : year;
}

function parseProcDt(procDt: string): number {
  if (!procDt) return 0;
  const parts = procDt.trim().split("/");
  if (parts.length !== 3) return 0;
  const [month, day, year] = parts;
  const d = new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
  );
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// Status 2 (Settled) and 4 (Amended/Settled) are equal priority, both > 1 (As Submitted)
function statusPriority(code: string): number {
  if (code === "2" || code === "4") return 2;
  if (code === "1") return 1;
  return 0;
}

/**
 * Given all rows from the RPT file, select the best report per
 * (PRVDR_NUM, fiscal_year). Priority: settled/amended > as-submitted;
 * ties broken by most recent PROC_DT; degenerate ties: last-seen + warning.
 *
 * Returns a Map from RPT_REC_NUM → the selected RPT row.
 */
export function selectBestReports(
  rptRows: Record<string, string>[],
): Map<string, Record<string, string>> {
  const byProviderYear = new Map<string, Record<string, string>>();

  for (const row of rptRows) {
    const ccn = row.PRVDR_NUM;
    const fy = parseFiscalYear(row.FY_END_DT);
    if (!ccn || fy === null) continue;

    const key = `${ccn}|${fy}`;
    const existing = byProviderYear.get(key);

    if (!existing) {
      byProviderYear.set(key, row);
      continue;
    }

    const newPriority = statusPriority(row.RPT_STUS_CD);
    const existingPriority = statusPriority(existing.RPT_STUS_CD);

    if (newPriority > existingPriority) {
      byProviderYear.set(key, row);
    } else if (newPriority === existingPriority) {
      const newProc = parseProcDt(row.PROC_DT);
      const existingProc = parseProcDt(existing.PROC_DT);
      if (newProc > existingProc) {
        byProviderYear.set(key, row);
      } else if (newProc === existingProc) {
        // Degenerate: same status and PROC_DT — last-seen wins
        console.warn(
          `Duplicate report for CCN ${ccn} FY ${fy} with identical status and PROC_DT. Using last-seen (RPT_REC_NUM: ${row.RPT_REC_NUM}).`,
        );
        byProviderYear.set(key, row);
      }
    }
  }

  const result = new Map<string, Record<string, string>>();
  for (const row of byProviderYear.values()) {
    result.set(row.RPT_REC_NUM, row);
  }
  return result;
}

// ─── NMRC Helpers ─────────────────────────────────────────────────────────

/**
 * Filter NMRC rows to only those in the selected set, grouped by RPT_REC_NUM.
 */
export function groupNmrcByRptRecNum(
  nmrcRows: Record<string, string>[],
  selectedRptRecNums: Set<string>,
): Map<string, Record<string, string>[]> {
  const grouped = new Map<string, Record<string, string>[]>();
  for (const row of nmrcRows) {
    const key = row.RPT_REC_NUM;
    if (!selectedRptRecNums.has(key)) continue;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}

/**
 * Look up a specific (WKSHT_CD, LINE_NUM, CLMN_NUM) coordinate in a group
 * of NMRC rows. Returns the numeric value, or null if absent or non-numeric.
 */
export function lookupValue(
  nmrcGroup: Record<string, string>[],
  wkshtCd: string,
  lineNum: string,
  clmnNum: string,
): number | null {
  const row = nmrcGroup.find(
    (r) =>
      r.WKSHT_CD === wkshtCd &&
      r.LINE_NUM === lineNum &&
      r.CLMN_NUM === clmnNum,
  );
  if (!row) return null;
  const val = parseFloat(row.ITM_VAL_NUM);
  return isNaN(val) ? null : val;
}

// ─── Calculations ──────────────────────────────────────────────────────────

/**
 * Compute charge_to_payment_ratio = total_charges / medicare_payments.
 * Returns null if either input is null, or if medicare_payments is 0.
 * Result is rounded to 2 decimal places.
 */
export function computeChargeToPaymentRatio(
  totalCharges: number | null,
  medicarePayments: number | null,
): number | null {
  if (totalCharges === null || medicarePayments === null) return null;
  if (medicarePayments === 0) return null;
  return Math.round((totalCharges / medicarePayments) * 100) / 100;
}

// ─── Provider Update Builder ───────────────────────────────────────────────

/**
 * Given payment records and a CCN→UUID map, determine the highest fiscal year
 * per provider and build the list of ProviderUpdate objects.
 *
 * Skips providers whose highest fiscal year has null medicare_payments.
 * Skips CCNs not in providerMap (already counted as missing).
 *
 * Returns { updates, skippedCcns } so callers can log skipped providers.
 */
export function buildProviderUpdates(
  paymentRecords: PaymentRecord[],
  providerMap: Map<string, string>,
): { updates: ProviderUpdate[]; skippedCcns: string[] } {
  const latestByProvider = new Map<string, PaymentRecord>();
  for (const record of paymentRecords) {
    if (!providerMap.has(record.prvdr_num)) continue;
    const existing = latestByProvider.get(record.prvdr_num);
    if (!existing || record.fiscal_year > existing.fiscal_year) {
      latestByProvider.set(record.prvdr_num, record);
    }
  }

  const updates: ProviderUpdate[] = [];
  const skippedCcns: string[] = [];

  for (const [ccn, record] of latestByProvider) {
    if (record.medicare_payments === null) {
      skippedCcns.push(ccn);
      continue;
    }
    updates.push({
      provider_id: providerMap.get(ccn)!,
      annual_medicare_payments: record.medicare_payments,
      payment_data_year: record.fiscal_year,
      payment_data_source: "hcris",
      charge_to_payment_ratio: computeChargeToPaymentRatio(
        record.total_charges,
        record.medicare_payments,
      ),
    });
  }

  return { updates, skippedCcns };
}

// ─── Supabase Helpers ──────────────────────────────────────────────────────

/** Resolve CCNs to provider UUIDs in batches of 1000. */
export async function resolveProviders(
  ccns: string[],
): Promise<Map<string, string>> {
  const supabaseAdmin = await getSupabaseAdmin();
  const map = new Map<string, string>();
  const chunkSize = 1000;
  for (let i = 0; i < ccns.length; i += chunkSize) {
    const chunk = ccns.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("id, cms_id")
      .in("cms_id", chunk);
    if (error) throw new Error(`Failed to resolve providers: ${error.message}`);
    for (const row of data ?? []) {
      map.set(row.cms_id, row.id);
    }
  }
  return map;
}

/**
 * Upsert payment_history rows in batches of 500.
 * On conflict (provider_id, fiscal_year), overwrites all non-key columns.
 */
export async function upsertPaymentHistory(
  rows: PaymentHistoryRow[],
): Promise<number> {
  // Deduplicate by (provider_id, fiscal_year) — last-seen wins.
  // Required when processing all-years bundles where the same provider-year
  // can appear in multiple year files (e.g., late filings).
  const deduped = new Map<string, PaymentHistoryRow>();
  for (const row of rows) {
    deduped.set(`${row.provider_id}:${row.fiscal_year}`, row);
  }
  const dedupedRows = [...deduped.values()];

  const supabaseAdmin = await getSupabaseAdmin();
  const BATCH_SIZE = 500;
  let total = 0;
  for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
    const batch = dedupedRows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabaseAdmin
      .from("payment_history")
      .upsert(batch, {
        onConflict: "provider_id,fiscal_year",
        count: "exact",
      });
    if (error) throw new Error(`Upsert batch failed: ${error.message}`);
    total += count ?? batch.length;
    console.log(
      `  Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${count} rows`,
    );
  }
  return total;
}

/** Update providers with payment data. Runs 50 concurrent updates per batch. */
export async function updateProviders(
  updates: ProviderUpdate[],
): Promise<number> {
  const supabaseAdmin = await getSupabaseAdmin();
  const CONCURRENT = 50;
  let total = 0;
  for (let i = 0; i < updates.length; i += CONCURRENT) {
    const batch = updates.slice(i, i + CONCURRENT);
    await Promise.all(
      batch.map(async (u) => {
        const { error } = await supabaseAdmin
          .from("providers")
          .update({
            annual_medicare_payments: u.annual_medicare_payments,
            payment_data_year: u.payment_data_year,
            payment_data_source: u.payment_data_source,
            charge_to_payment_ratio: u.charge_to_payment_ratio,
            updated_at: new Date().toISOString(),
          })
          .eq("id", u.provider_id);
        if (error)
          throw new Error(`Provider update failed: ${error.message}`);
      }),
    );
    total += batch.length;
  }
  return total;
}
