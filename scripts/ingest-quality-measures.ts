// scripts/ingest-quality-measures.ts
import { fetchAllPages } from "./lib/cms-api";
import { supabaseAdmin } from "./lib/supabase-admin";
import { type QualityMeasureRow, type CmsRecord } from "./lib/quality-measures";

// Note: CmsRecord is used in extractCcns() parameter type; QualityMeasureRow is used in upsert helpers.
import { transformQualitySnf } from "./lib/transform-quality-snf";
import { transformQualityHha } from "./lib/transform-quality-hha";
import { transformQualityHospice } from "./lib/transform-quality-hospice";

const UPSERT_BATCH_SIZE = 500;
const PROVIDER_PAGE_SIZE = 1000;

/**
 * Fetches all providers in paginated batches and returns a Map<cms_id, uuid>.
 * A plain .select() would silently return only the first 1000 rows from Supabase.
 */
async function buildProviderLookup(): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("id, cms_id")
      .range(from, from + PROVIDER_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load providers: ${error.message}`);
    for (const row of data ?? []) {
      lookup.set(row.cms_id, row.id);
    }
    if ((data ?? []).length < PROVIDER_PAGE_SIZE) break;
    from += PROVIDER_PAGE_SIZE;
  }
  return lookup;
}

async function upsertBatch(batch: QualityMeasureRow[]): Promise<number> {
  const { error, count } = await supabaseAdmin
    .from("quality_measures")
    .upsert(batch, {
      onConflict: "provider_id,measure_code",
      count: "exact",
    });
  if (error) throw new Error(`Upsert failed: ${error.message}`);
  return count ?? batch.length;
}

async function upsertRows(rows: QualityMeasureRow[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    total += await upsertBatch(batch);
    console.log(
      `  Upserted batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}: ${batch.length} rows`,
    );
  }
  return total;
}

function extractCcns(rawRows: CmsRecord[]): Set<string> {
  const ccns = new Set<string>();
  for (const row of rawRows) {
    const ccn = row.cms_certification_number_ccn?.trim();
    if (ccn) ccns.add(ccn);
  }
  return ccns;
}

function countMatched(
  rawCcns: Set<string>,
  lookup: Map<string, string>,
): { matched: number; missing: number } {
  let matched = 0;
  for (const ccn of rawCcns) {
    if (lookup.has(ccn)) matched++;
  }
  return { matched, missing: rawCcns.size - matched };
}

export async function main() {
  console.log("Starting CMS quality measures ingestion...");

  console.log("Building provider lookup (paginated)...");
  const lookup = await buildProviderLookup();
  console.log(`Loaded ${lookup.size} providers`);

  let totalUpserted = 0;

  // --- SNF ---
  console.log("\nFetching SNF MDS quality measures (djen-97ju)...");
  const snfRaw = await fetchAllPages("djen-97ju");
  const snfRows = transformQualitySnf(snfRaw, lookup);
  const snfCcns = extractCcns(snfRaw);
  const snfStats = countMatched(snfCcns, lookup);
  console.log(
    `SNF: ${snfRows.length} rows from ${snfCcns.size} CCNs — ${snfStats.matched} matched, ${snfStats.missing} missing`,
  );
  const snfUpserted = await upsertRows(snfRows);
  totalUpserted += snfUpserted;

  // --- HHA ---
  console.log("\nFetching HHA quality measures (6jpm-sxkc)...");
  const hhaProviderRaw = await fetchAllPages("6jpm-sxkc");
  let hhaNationalRow: CmsRecord | null = null;
  try {
    const hhaNationalRaw = await fetchAllPages("97z8-de96");
    hhaNationalRow = hhaNationalRaw[0] ?? null;
    if (!hhaNationalRow) {
      console.warn("HHA national avg dataset returned no rows — national_avg will be null");
    }
  } catch (err) {
    console.warn(
      "Failed to fetch HHA national averages — national_avg will be null:",
      err instanceof Error ? err.message : String(err),
    );
  }
  const hhaRows = transformQualityHha(hhaProviderRaw, hhaNationalRow, lookup);
  const hhaCcns = extractCcns(hhaProviderRaw);
  const hhaStats = countMatched(hhaCcns, lookup);
  console.log(
    `HHA: ${hhaRows.length} rows from ${hhaCcns.size} CCNs — ${hhaStats.matched} matched, ${hhaStats.missing} missing`,
  );
  const hhaUpserted = await upsertRows(hhaRows);
  totalUpserted += hhaUpserted;

  // --- Hospice ---
  console.log("\nFetching Hospice quality measures (252m-zfp9, gxki-hrr8, 7cv8-v37d)...");
  const hospiceClaimsRaw = await fetchAllPages("252m-zfp9");
  const hospiceCahpsRaw = await fetchAllPages("gxki-hrr8");
  const hospiceCahpsNationalRaw = await fetchAllPages("7cv8-v37d");
  const hospiceRows = transformQualityHospice(
    hospiceClaimsRaw,
    hospiceCahpsRaw,
    hospiceCahpsNationalRaw,
    lookup,
  );
  const hospiceCcns = new Set([
    ...extractCcns(hospiceClaimsRaw),
    ...extractCcns(hospiceCahpsRaw),
  ]);
  const hospiceStats = countMatched(hospiceCcns, lookup);
  console.log(
    `Hospice: ${hospiceRows.length} rows from ${hospiceCcns.size} CCNs — ${hospiceStats.matched} matched, ${hospiceStats.missing} missing`,
  );
  const hospiceUpserted = await upsertRows(hospiceRows);
  totalUpserted += hospiceUpserted;

  // --- Summary ---
  console.log("\n--- Quality Measures Ingestion Summary ---");
  console.log(`SNF:     ${snfRows.length} rows produced, ${snfStats.matched} providers matched, ${snfStats.missing} missing, ${snfUpserted} upserted`);
  console.log(`HHA:     ${hhaRows.length} rows produced, ${hhaStats.matched} providers matched, ${hhaStats.missing} missing, ${hhaUpserted} upserted`);
  console.log(`Hospice: ${hospiceRows.length} rows produced, ${hospiceStats.matched} providers matched, ${hospiceStats.missing} missing, ${hospiceUpserted} upserted`);
  console.log(`Total:   ${totalUpserted} rows upserted`);

  if (totalUpserted === 0) {
    console.error("Zero records upserted — exiting with failure");
    process.exit(1);
  }

  console.log("\nIngestion complete.");
}

// Only auto-run when executed directly as a script, not when imported by tests
const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Ingestion failed:", error);
    process.exit(1);
  });
}
