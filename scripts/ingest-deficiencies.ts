import { fetchAllPages } from "./lib/cms-api";
import { supabaseAdmin } from "./lib/supabase-admin";
import {
  transformDeficiencyRecord,
  type DeficiencyRow,
} from "./lib/transform-deficiencies";

const DATASET_ID = "r5ix-sfxw";
const UPSERT_BATCH_SIZE = 500;

async function resolveProviders(
  cmsIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const chunkSize = 1000;
  for (let i = 0; i < cmsIds.length; i += chunkSize) {
    const chunk = cmsIds.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("id, cms_id")
      .in("cms_id", chunk);

    if (error) {
      throw new Error(`Failed to resolve providers: ${error.message}`);
    }

    for (const row of data ?? []) {
      map.set(row.cms_id, row.id);
    }
  }

  return map;
}

async function upsertBatch(batch: DeficiencyRow[]): Promise<number> {
  const { error, count } = await supabaseAdmin
    .from("deficiencies")
    .upsert(batch, {
      onConflict: "provider_id,survey_date,deficiency_tag",
      count: "exact",
    });

  if (error) {
    throw new Error(`Upsert batch failed: ${error.message}`);
  }

  return count ?? batch.length;
}

export async function main() {
  console.log("Starting CMS deficiency data ingestion...");

  // 1. Fetch all records from CMS
  const rawRecords = await fetchAllPages(DATASET_ID);

  // 2. Resolve CMS IDs to provider UUIDs
  const uniqueCmsIds = [
    ...new Set(
      rawRecords
        .map((r) => r.cms_certification_number_ccn)
        .filter(Boolean) as string[],
    ),
  ];
  console.log(`Found ${uniqueCmsIds.length} unique CMS provider IDs`);

  const providerMap = await resolveProviders(uniqueCmsIds);
  console.log(`Resolved ${providerMap.size} providers`);

  const unmatchedCount = uniqueCmsIds.length - providerMap.size;
  if (unmatchedCount > 0) {
    const unmatched = uniqueCmsIds.filter((id) => !providerMap.has(id));
    console.warn(
      `${unmatchedCount} CMS IDs not found in providers table:`,
      unmatched.slice(0, 10).join(", "),
      unmatchedCount > 10 ? `... and ${unmatchedCount - 10} more` : "",
    );
  }

  // 3. Transform records
  const transformed: DeficiencyRow[] = [];
  let skippedCount = 0;

  for (const raw of rawRecords) {
    const row = transformDeficiencyRecord(raw, providerMap);
    if (row) {
      transformed.push(row);
    } else {
      skippedCount++;
    }
  }

  console.log(
    `Transformed ${transformed.length} records (${skippedCount} skipped)`,
  );

  if (transformed.length === 0) {
    console.error("No records to upsert — exiting with failure");
    process.exit(1);
  }

  // 4. Upsert in batches
  let totalUpserted = 0;
  for (let i = 0; i < transformed.length; i += UPSERT_BATCH_SIZE) {
    const batch = transformed.slice(i, i + UPSERT_BATCH_SIZE);
    const count = await upsertBatch(batch);
    totalUpserted += count;
    console.log(
      `Upserted batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}: ${count} records`,
    );
  }

  // 5. Report
  console.log("\n--- Ingestion Summary ---");
  console.log(`Total fetched:     ${rawRecords.length}`);
  console.log(`Providers matched: ${providerMap.size}/${uniqueCmsIds.length}`);
  console.log(`Records skipped:   ${skippedCount}`);
  console.log(`Records upserted:  ${totalUpserted}`);

  if (totalUpserted === 0) {
    console.error("Zero records upserted — exiting with failure");
    process.exit(1);
  }

  console.log("Ingestion complete.");
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
