// scripts/ingest-puf.ts
import { resolveProviders } from "./lib/hcris";
import {
  fetchAndParsePufCsv,
  transformPufRows,
  upsertPufPaymentHistory,
  buildPufProviderUpdates,
  updateProvidersFromPuf,
} from "./lib/puf";

// Update these URLs annually when CMS publishes new PUF data.
// Find updated URLs at: https://data.cms.gov (search "Post-Acute Care Utilization")
const PUF_URLS = {
  snf: "https://data.cms.gov/sites/default/files/2025-08/b646c0b9-5fe0-475c-8820-007680020fdc/RY_2025_RY_25_PAC_PUF_SNF_2023_main_final_unformatted.csv",
  hha: "https://data.cms.gov/sites/default/files/2025-08/1d04af0f-9173-47b0-b5f8-26df7722247c/RY_2025_RY_25_PAC_PUF_HH_2023_main_final_unformatted.csv",
  hospice:
    "https://data.cms.gov/sites/default/files/2025-08/7c92ef92-85ff-4f2a-a1a6-b1f4f25210e4/RY_2025_RY_25_PAC_PUF_HOS_2023_main_final_unformatted.csv",
};

// UUID-based .in() queries generate long URLs (~39 chars per UUID including
// separators). 100 UUIDs ≈ 3.9KB — safely under the 8KB URL limit most
// proxies/servers enforce. Higher counts cause "fetch failed" network errors.
const CHUNK_SIZE = 100;

export async function main() {
  const { supabaseAdmin } = await import("./lib/supabase-admin");

  // ── Step 1: Fetch and parse all three CSVs ──────────────────────────────
  console.log("Fetching SNF PUF...");
  const snfRaw = await fetchAndParsePufCsv(PUF_URLS.snf);
  console.log(`  ${snfRaw.length} total rows (including summaries)`);

  console.log("Fetching HHA PUF...");
  const hhaRaw = await fetchAndParsePufCsv(PUF_URLS.hha);
  console.log(`  ${hhaRaw.length} total rows`);

  console.log("Fetching Hospice PUF...");
  const hospiceRaw = await fetchAndParsePufCsv(PUF_URLS.hospice);
  console.log(`  ${hospiceRaw.length} total rows`);

  // ── Step 2: Collect and deduplicate CCNs, resolve to provider UUIDs ─────
  const allCcns = [
    ...snfRaw
      .filter((r) => r.SMRY_CTGRY === "PROVIDER")
      .map((r) => r.PRVDR_ID?.trim()),
    ...hhaRaw
      .filter((r) => r.SMRY_CTGRY === "PROVIDER")
      .map((r) => r.PRVDR_ID?.trim()),
    ...hospiceRaw
      .filter((r) => r.SMRY_CTGRY === "PROVIDER")
      .map((r) => r.PRVDR_ID?.trim()),
  ].filter(Boolean) as string[];

  const uniqueCcns = [...new Set(allCcns)];
  console.log(
    `\nResolving ${uniqueCcns.length} unique CCNs to provider UUIDs...`,
  );
  const lookup = await resolveProviders(uniqueCcns);
  console.log(`  Matched ${lookup.size} providers`);

  // ── Step 3: Transform each dataset ──────────────────────────────────────
  const snfRows = transformPufRows(snfRaw, lookup);
  const hhaRows = transformPufRows(hhaRaw, lookup);
  const hospiceRows = transformPufRows(hospiceRaw, lookup);

  console.log(`\nSNF:     ${snfRows.length} provider rows`);
  console.log(`HHA:     ${hhaRows.length} provider rows`);
  console.log(`Hospice: ${hospiceRows.length} provider rows`);

  // ── Step 4: Upsert each dataset (DO NOTHING on conflict with HCRIS) ─────
  console.log("\nUpserting SNF payment history...");
  const snfInserted = await upsertPufPaymentHistory(snfRows);

  console.log("Upserting HHA payment history...");
  const hhaInserted = await upsertPufPaymentHistory(hhaRows);

  console.log("Upserting Hospice payment history...");
  const hospiceInserted = await upsertPufPaymentHistory(hospiceRows);

  // ── Step 5: Build provider updates ──────────────────────────────────────
  const allRows = [...snfRows, ...hhaRows, ...hospiceRows];
  const allProviderIds = [...new Set(allRows.map((r) => r.provider_id))];

  // Query current payment_data_source for each provider in chunks of 1000.
  const currentDataSources = new Map<string, string | null>();
  for (let i = 0; i < allProviderIds.length; i += CHUNK_SIZE) {
    const chunk = allProviderIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("id, payment_data_source")
      .in("id", chunk);
    if (error) throw new Error(`Failed to query providers: ${error.message}`);
    for (const p of data ?? []) {
      currentDataSources.set(p.id, p.payment_data_source ?? null);
    }
  }

  const updates = buildPufProviderUpdates(allRows, currentDataSources);

  // ── Step 6: Update providers (DB guard: payment_data_source IS NULL) ────
  console.log(
    `\nUpdating ${updates.length} providers with PUF payment data...`,
  );
  const providersUpdated = await updateProvidersFromPuf(updates);

  // ── Step 7: Summary ──────────────────────────────────────────────────────
  const totalAttempted = snfRows.length + hhaRows.length + hospiceRows.length;
  const totalInserted = snfInserted + hhaInserted + hospiceInserted;
  const skipped = totalAttempted - totalInserted;

  console.log("\n--- PUF Ingestion Summary ---");
  console.log(
    `SNF:     ${snfRows.length} rows attempted, ${snfInserted} inserted`,
  );
  console.log(
    `HHA:     ${hhaRows.length} rows attempted, ${hhaInserted} inserted`,
  );
  console.log(
    `Hospice: ${hospiceRows.length} rows attempted, ${hospiceInserted} inserted`,
  );
  console.log(
    `Total:   ${totalAttempted} attempted, ${totalInserted} inserted, ${skipped} skipped (HCRIS conflicts)`,
  );
  console.log(`Providers updated: ${providersUpdated}`);
  console.log("Ingestion complete.");
}

const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
