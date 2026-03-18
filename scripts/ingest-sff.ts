// scripts/ingest-sff.ts
import { readFileSync } from "fs";
import { PDFParse } from "pdf-parse";
import { resolveProviders } from "./lib/hcris";
import { parseSffText } from "./lib/sff";

// UUID-based .in() queries use URL params in PostgREST (~37 chars/UUID).
// 100 UUIDs ≈ 3.7KB — safely under the 8KB limit that causes "fetch failed" errors.
const CHUNK_SIZE = 100;

export async function main() {
  const { supabaseAdmin } = await import("./lib/supabase-admin");

  // ── Step 1: Validate CLI arg ─────────────────────────────────────────────
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/ingest-sff.ts <path-to-pdf>");
    process.exit(1);
  }

  let buffer: Buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    console.error(`Error: could not read file at path: ${filePath}`);
    process.exit(1);
  }

  // ── Step 2: Parse PDF ────────────────────────────────────────────────────
  console.log(`Parsing PDF: ${filePath}`);
  const parsed = await new PDFParse({ data: buffer }).getText();
  const { sffCcns, candidateCcns } = parseSffText(parsed.text);
  console.log(
    `Found ${sffCcns.length} SFF CCNs and ${candidateCcns.length} candidate CCNs in PDF`,
  );

  // ── Step 3: Resolve CCNs to provider UUIDs ───────────────────────────────
  const allCcns = [...sffCcns, ...candidateCcns];
  console.log(`\nResolving ${allCcns.length} CCNs to provider UUIDs...`);
  const lookup = await resolveProviders(allCcns);
  console.log(`  Matched ${lookup.size} / ${allCcns.length} CCNs`);

  // ── Step 4: Log unmatched CCNs (informational) ───────────────────────────
  const unmatchedCcns = allCcns.filter((ccn) => !lookup.has(ccn));
  if (unmatchedCcns.length > 0) {
    console.warn(`\nUnmatched CCNs (not found in providers table):`);
    for (const ccn of unmatchedCcns) {
      console.warn(`  ${ccn}`);
    }
  }

  const sffIds = sffCcns
    .map((ccn) => lookup.get(ccn))
    .filter((id): id is string => id !== undefined);
  const candidateIds = candidateCcns
    .map((ccn) => lookup.get(ccn))
    .filter((id): id is string => id !== undefined);

  // ── Step 5: Clear all existing SFF flags ─────────────────────────────────
  // is_sff and is_sff_candidate default to false — NULLs not expected from
  // standard ingestion. Filter targets rows that actually need clearing.
  console.log("\nClearing existing SFF flags...");
  const { error: clearError } = await supabaseAdmin
    .from("providers")
    .update({ is_sff: false, is_sff_candidate: false })
    .or("is_sff.eq.true,is_sff_candidate.eq.true");
  if (clearError) {
    throw new Error(`Failed to clear SFF flags: ${clearError.message}`);
  }

  // ── Step 6: Set SFF flags ────────────────────────────────────────────────
  let sffUpdated = 0;
  if (sffIds.length > 0) {
    for (let i = 0; i < sffIds.length; i += CHUNK_SIZE) {
      const chunk = sffIds.slice(i, i + CHUNK_SIZE);
      const { error } = await supabaseAdmin
        .from("providers")
        .update({ is_sff: true })
        .in("id", chunk);
      if (error) throw new Error(`Failed to set SFF flags: ${error.message}`);
      sffUpdated += chunk.length;
    }
  }

  // ── Step 7: Set candidate flags ──────────────────────────────────────────
  let candidatesUpdated = 0;
  if (candidateIds.length > 0) {
    for (let i = 0; i < candidateIds.length; i += CHUNK_SIZE) {
      const chunk = candidateIds.slice(i, i + CHUNK_SIZE);
      const { error } = await supabaseAdmin
        .from("providers")
        .update({ is_sff_candidate: true })
        .in("id", chunk);
      if (error) {
        throw new Error(`Failed to set SFF candidate flags: ${error.message}`);
      }
      candidatesUpdated += chunk.length;
    }
  }

  // ── Step 8: Summary ───────────────────────────────────────────────────────
  console.log("\n--- SFF Ingestion Summary ---");
  console.log(
    `CCNs in PDF:       ${sffCcns.length} SFF + ${candidateCcns.length} candidates = ${allCcns.length} total`,
  );
  console.log(`Matched:           ${lookup.size}`);
  console.log(`Unmatched:         ${unmatchedCcns.length}`);
  console.log(`SFF updated:       ${sffUpdated}`);
  console.log(`Candidates updated: ${candidatesUpdated}`);
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
