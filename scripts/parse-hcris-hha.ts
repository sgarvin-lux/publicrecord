import * as path from "path";
import {
  extractZip,
  cleanupTempDir,
  findFileBySuffix,
  parsePipeDelimited,
  selectBestReports,
  groupNmrcByRptRecNum,
  resolveProviders,
  upsertPaymentHistory,
  updateProviders,
  buildProviderUpdates,
  type PaymentHistoryRow,
} from "./lib/hcris";
import { transformHha } from "./lib/transform-hcris-hha";

export async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error("Usage: npx tsx scripts/parse-hcris-hha.ts <path-to-zip>");
    process.exit(1);
  }

  console.log(`Starting HCRIS HHA ingestion from: ${path.resolve(zipPath)}`);

  let tempDir: string | null = null;
  try {
    console.log("Extracting zip...");
    tempDir = extractZip(zipPath);

    console.log("Loading RPT file...");
    const rptPath = findFileBySuffix(tempDir, "_RPT_");
    const rptRows = await parsePipeDelimited(rptPath);
    console.log(`  Loaded ${rptRows.length} RPT rows`);

    const selectedReports = selectBestReports(rptRows);
    console.log(`  Selected ${selectedReports.size} reports (best per provider-year)`);

    console.log("Loading NMRC file...");
    const nmrcPath = findFileBySuffix(tempDir, "_NMRC_");
    const nmrcRows = await parsePipeDelimited(nmrcPath);
    console.log(`  Loaded ${nmrcRows.length} NMRC rows`);

    const selectedRptRecNums = new Set(selectedReports.keys());
    const nmrcGroups = groupNmrcByRptRecNum(nmrcRows, selectedRptRecNums);

    const paymentRecords = [];
    let totalVisits = 0;
    for (const [rptRecNum, rptRow] of selectedReports) {
      const nmrcGroup = nmrcGroups.get(rptRecNum) ?? [];
      const record = transformHha(rptRow, nmrcGroup);
      totalVisits += record.total_visits ?? 0;
      paymentRecords.push(record);
    }

    const uniqueCcns = [...new Set(paymentRecords.map((r) => r.prvdr_num))];
    console.log(`\nResolving ${uniqueCcns.length} unique provider CCNs...`);
    const providerMap = await resolveProviders(uniqueCcns);

    const missingCcns = uniqueCcns.filter((ccn) => !providerMap.has(ccn));
    if (missingCcns.length > 0) {
      console.warn(
        `${missingCcns.length} CCNs not found in providers table:`,
        missingCcns.slice(0, 10).join(", "),
        missingCcns.length > 10 ? `... and ${missingCcns.length - 10} more` : "",
      );
    }

    const historyRows: PaymentHistoryRow[] = paymentRecords
      .filter((r) => providerMap.has(r.prvdr_num))
      .map((r) => ({
        provider_id: providerMap.get(r.prvdr_num)!,
        fiscal_year: r.fiscal_year,
        medicare_payments: r.medicare_payments,
        total_charges: r.total_charges,
        total_days: r.total_days,
        total_patients: r.total_patients,
        data_source: "hcris" as const,
      }));

    console.log(`\nUpserting ${historyRows.length} rows to payment_history...`);
    const upserted = await upsertPaymentHistory(historyRows);

    if (upserted === 0) {
      console.error("Zero rows upserted — exiting with failure");
      process.exit(1);
    }

    const { updates: providerUpdates, skippedCcns } = buildProviderUpdates(
      paymentRecords,
      providerMap,
    );

    if (skippedCcns.length > 0) {
      for (const ccn of skippedCcns) {
        console.warn(
          `Skipping providers update for CCN ${ccn}: medicare_payments is null for highest fiscal year`,
        );
      }
    }

    console.log(`\nUpdating ${providerUpdates.length} providers...`);
    const providersUpdated = await updateProviders(providerUpdates);

    const fiscalYears = [...new Set(paymentRecords.map((r) => r.fiscal_year))].sort();
    const totalRevenue = paymentRecords
      .filter((r) => r.medicare_payments !== null)
      .reduce((sum, r) => sum + r.medicare_payments!, 0);

    console.log("\n--- HCRIS HHA Ingestion Summary ---");
    console.log(`Fiscal years found:            ${fiscalYears.join(", ")}`);
    console.log(`Reports processed:             ${selectedReports.size}`);
    console.log(`Providers matched:             ${providerMap.size}  (found in DB)`);
    console.log(`Providers missing:             ${missingCcns.length}  (CCN not found)`);
    console.log(`payment_history rows upserted: ${upserted}`);
    console.log(`providers updated:             ${providersUpdated}`);
    if (skippedCcns.length > 0) {
      console.log(`providers skipped (null pay):  ${skippedCcns.length}`);
    }
    console.log(
      `Total Medicare revenue:        $${totalRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    );
    console.log(
      `Total visits (logged only):    ${totalVisits.toLocaleString("en-US")}`,
    );
    console.log("\nIngestion complete.");
  } finally {
    if (tempDir) cleanupTempDir(tempDir);
  }
}

const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Ingestion failed:", error);
    process.exit(1);
  });
}
