import { supabaseAdmin } from "./lib/supabase-admin";
import { fetchAllPages } from "./lib/cms-api";
import { transformOwnership, normalizeEntityName } from "./lib/transform-ownership";

interface OwnershipInsertRow {
  provider_id: string;
  operator_id: null;
  owner_name: string;
  owner_type: string | null;
  ownership_pct: number | null;
  effective_date: string | null;
}

export async function main(): Promise<void> {
  // Phase 1: Fetch
  const rawRecords = await fetchAllPages("y2hd-n93e");
  console.log(`Fetched ${rawRecords.length} raw ownership records`);

  // Phase 2: Build provider lookup (cms_id → provider_id)
  const uniqueCmsIds = [...new Set(rawRecords.map((r) => r["cms_certification_number_ccn"]).filter(Boolean))];
  const providerMap = new Map<string, string>();
  for (let i = 0; i < uniqueCmsIds.length; i += 500) {
    const chunk = uniqueCmsIds.slice(i, i + 500);
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("id, cms_id")
      .in("cms_id", chunk);
    if (error) throw new Error(`Provider lookup failed: ${error.message}`);
    for (const row of data as Array<{ id: string; cms_id: string }>) {
      providerMap.set(row.cms_id, row.id);
    }
  }
  console.log(`Loaded ${providerMap.size} providers into lookup`);

  // Phase 3: Full replace teardown
  // Step 1: Delete all provider_ownership rows
  const { error: e1 } = await supabaseAdmin
    .from("provider_ownership")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (e1) throw new Error(`Delete provider_ownership failed: ${e1.message}`);

  // Step 2: Null out providers.operator_id (batched)
  const allProviderIds = [...providerMap.values()];
  for (let i = 0; i < allProviderIds.length; i += 500) {
    const chunk = allProviderIds.slice(i, i + 500);
    const { error } = await supabaseAdmin
      .from("providers")
      .update({ operator_id: null })
      .in("id", chunk);
    if (error) throw new Error(`Null operator_id failed: ${error.message}`);
  }

  // Step 3: Delete all operators
  const { error: e3 } = await supabaseAdmin
    .from("operators")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (e3) throw new Error(`Delete operators failed: ${e3.message}`);

  // Phase 4: Transform and insert
  let skippedCount = 0;
  const skippedSamples: string[] = [];
  const inserts: OwnershipInsertRow[] = [];

  for (const raw of rawRecords) {
    const row = transformOwnership(raw);
    if (!row) continue;
    const providerId = providerMap.get(row.cms_id);
    if (!providerId) {
      skippedCount++;
      if (skippedSamples.length < 5) skippedSamples.push(row.cms_id);
      continue;
    }
    inserts.push({
      provider_id: providerId,
      operator_id: null,
      owner_name: row.owner_name,
      owner_type: row.owner_type,
      ownership_pct: row.ownership_pct,
      effective_date: row.effective_date,
    });
  }

  if (skippedCount > 0) {
    console.warn(
      `Skipped ${skippedCount} records with no matching provider (sample IDs: ${skippedSamples.join(", ")})`
    );
  }

  let totalInserted = 0;
  for (let i = 0; i < inserts.length; i += 500) {
    const batch = inserts.slice(i, i + 500);
    const { data, error } = await supabaseAdmin
      .from("provider_ownership")
      .insert(batch)
      .select();
    if (error) throw new Error(`Insert provider_ownership failed: ${error.message}`);
    totalInserted += (data ?? []).length;
  }

  if (totalInserted === 0) {
    console.error("Zero rows inserted into provider_ownership — possible CMS API failure");
    process.exit(1);
  }
  console.log(`Inserted ${totalInserted} provider_ownership rows`);

  // Phase 5: Match and link
  // Re-fetch from DB (need Postgres-assigned UUIDs)
  const ownershipRows: Array<{ id: string; owner_name: string; provider_id: string }> = [];
  let p5from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("provider_ownership")
      .select("id, owner_name, provider_id")
      .range(p5from, p5from + 999);
    if (error) throw new Error(`Fetch ownership rows failed: ${error.message}`);
    if (!data || data.length === 0) break;
    ownershipRows.push(...(data as typeof ownershipRows));
    if (data.length < 1000) break;
    p5from += 1000;
  }

  // Group by normalized name
  const groups = new Map<
    string,
    { ownershipIds: string[]; providerIds: Set<string>; rawNames: string[] }
  >();
  for (const row of ownershipRows) {
    const key = normalizeEntityName(row.owner_name);
    const existing = groups.get(key);
    if (existing) {
      existing.ownershipIds.push(row.id);
      existing.providerIds.add(row.provider_id);
      existing.rawNames.push(row.owner_name);
    } else {
      groups.set(key, {
        ownershipIds: [row.id],
        providerIds: new Set([row.provider_id]),
        rawNames: [row.owner_name],
      });
    }
  }

  // Create operators for groups with 2+ distinct providers
  let operatorCount = 0;
  for (const [, group] of groups) {
    if (group.providerIds.size < 2) continue;

    const operatorName = [...new Set(group.rawNames)].sort()[0];
    const providerIdList = [...group.providerIds];

    const { data: opData, error: opErr } = await supabaseAdmin
      .from("operators")
      .insert({ name: operatorName, facility_count: providerIdList.length })
      .select();
    if (opErr) throw new Error(`Insert operator failed: ${opErr.message}`);
    if (!opData || opData.length === 0) {
      throw new Error(`Insert operator returned no data for name: ${operatorName}`);
    }
    const operatorId = (opData as Array<{ id: string }>)[0].id;

    const { error: poErr } = await supabaseAdmin
      .from("provider_ownership")
      .update({ operator_id: operatorId })
      .in("id", group.ownershipIds);
    if (poErr) throw new Error(`Update provider_ownership failed: ${poErr.message}`);

    const { error: provErr } = await supabaseAdmin
      .from("providers")
      .update({ operator_id: operatorId })
      .in("id", providerIdList);
    if (provErr) throw new Error(`Update providers failed: ${provErr.message}`);

    operatorCount++;
  }

  console.log("\n--- Ingestion Summary ---");
  console.log(`Fetched: ${rawRecords.length} raw ownership records`);
  console.log(`Matched: ${inserts.length} records to providers`);
  if (skippedCount > 0) {
    console.log(`Skipped: ${skippedCount} records (no matching provider)`);
  }
  console.log(`Inserted: ${totalInserted} provider_ownership rows`);
  console.log(`Operators created: ${operatorCount}`);
}

const isDirectRun = import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Ownership ingestion failed:", error);
    process.exit(1);
  });
}
