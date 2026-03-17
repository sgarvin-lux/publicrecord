import { fetchAllPages } from "./lib/cms-api";
import { supabaseAdmin } from "./lib/supabase-admin";
import {
  DATASETS,
  type ProviderRow,
  type DatasetConfig,
} from "./lib/transform-providers";

const UPSERT_BATCH_SIZE = 500;

async function upsertBatch(batch: ProviderRow[]): Promise<number> {
  const { error, count } = await supabaseAdmin.from("providers").upsert(batch, {
    onConflict: "cms_id",
    count: "exact",
  });

  if (error) {
    throw new Error(`Upsert batch failed: ${error.message}`);
  }

  return count ?? batch.length;
}

function deduplicateByCmsId(rows: ProviderRow[]): ProviderRow[] {
  const seen = new Map<string, ProviderRow>();
  for (const row of rows) {
    seen.set(row.cms_id, row); // last-writer-wins: matches upsert semantics
  }
  return [...seen.values()];
}

async function ingestDataset(config: DatasetConfig): Promise<{
  fetched: number;
  transformed: number;
  skipped: number;
  upserted: number;
}> {
  console.log(
    `\nIngesting ${config.providerType} (dataset: ${config.datasetId})...`,
  );

  const rawRecords = await fetchAllPages(config.datasetId);

  const transformed: ProviderRow[] = [];
  let skipped = 0;

  for (const raw of rawRecords) {
    const row = config.transform(raw);
    if (row) {
      transformed.push(row);
    } else {
      skipped++;
    }
  }

  // Hospice dataset has multiple rows per provider (one per measure)
  const deduplicated = deduplicateByCmsId(transformed);
  if (deduplicated.length < transformed.length) {
    console.log(
      `Deduplicated: ${transformed.length} → ${deduplicated.length} unique providers`,
    );
  }

  console.log(
    `Transformed ${deduplicated.length} ${config.providerType} records (${skipped} skipped)`,
  );

  let totalUpserted = 0;
  for (let i = 0; i < deduplicated.length; i += UPSERT_BATCH_SIZE) {
    const batch = deduplicated.slice(i, i + UPSERT_BATCH_SIZE);
    const count = await upsertBatch(batch);
    totalUpserted += count;
    console.log(
      `Upserted batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}: ${count} records`,
    );
  }

  return {
    fetched: rawRecords.length,
    transformed: deduplicated.length,
    skipped,
    upserted: totalUpserted,
  };
}

export async function main() {
  console.log("Starting CMS provider data ingestion...");

  let totalFetched = 0;
  let totalTransformed = 0;
  let totalSkipped = 0;
  let totalUpserted = 0;

  for (const dataset of DATASETS) {
    const stats = await ingestDataset(dataset);
    totalFetched += stats.fetched;
    totalTransformed += stats.transformed;
    totalSkipped += stats.skipped;
    totalUpserted += stats.upserted;
  }

  console.log("\n--- Ingestion Summary ---");
  console.log(`Total fetched:      ${totalFetched}`);
  console.log(`Total transformed:  ${totalTransformed}`);
  console.log(`Total skipped:      ${totalSkipped}`);
  console.log(`Total upserted:     ${totalUpserted}`);

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
