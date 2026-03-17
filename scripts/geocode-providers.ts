import { supabaseAdmin } from "./lib/supabase-admin";
import { geocodeAddress } from "./lib/mapbox-geocode";

const BATCH_SIZE = 100;
// Mapbox free tier: 100k requests/month, 600/min
// ~10 req/sec keeps us well under the rate limit
const DELAY_BETWEEN_REQUESTS_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchProvidersNeedingGeocode(limit: number): Promise<
  Array<{
    id: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  }>
> {
  const { data, error } = await supabaseAdmin
    .from("providers")
    .select("id, address, city, state, zip")
    .is("lat", null)
    .not("address", "is", null)
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch providers: ${error.message}`);
  }

  return data ?? [];
}

export async function main() {
  const accessToken = process.env.MAPBOX_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("Missing MAPBOX_ACCESS_TOKEN environment variable");
  }

  console.log("Starting provider geocoding...");

  let totalGeocoded = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  // Process in batches until no more providers need geocoding
  let hasMore = true;
  while (hasMore) {
    const providers = await fetchProvidersNeedingGeocode(BATCH_SIZE);

    if (providers.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`Processing batch of ${providers.length} providers...`);

    for (const provider of providers) {
      try {
        const result = await geocodeAddress(provider, accessToken);

        if (result) {
          const { error } = await supabaseAdmin
            .from("providers")
            .update({ lat: result.lat, lng: result.lng })
            .eq("id", provider.id);

          if (error) {
            console.error(
              `Failed to update provider ${provider.id}: ${error.message}`,
            );
            totalFailed++;
          } else {
            totalGeocoded++;
          }
        } else {
          totalSkipped++;
        }

        await sleep(DELAY_BETWEEN_REQUESTS_MS);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Geocoding failed for provider ${provider.id}: ${msg}`);
        totalFailed++;
      }
    }

    console.log(
      `Batch complete: ${totalGeocoded} geocoded, ${totalSkipped} skipped, ${totalFailed} failed`,
    );
  }

  console.log("\n--- Geocoding Summary ---");
  console.log(`Total geocoded: ${totalGeocoded}`);
  console.log(`Total skipped:  ${totalSkipped}`);
  console.log(`Total failed:   ${totalFailed}`);

  if (totalGeocoded === 0 && totalFailed === 0 && totalSkipped === 0) {
    console.log("No providers needed geocoding.");
  }

  // Only fail if every attempt failed (some failures are expected for bad addresses)
  if (totalFailed > 0 && totalGeocoded === 0) {
    console.error("All geocoding attempts failed — exiting with failure");
    process.exit(1);
  }

  console.log("Geocoding complete.");
}

// Only auto-run when executed directly as a script, not when imported by tests
const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Geocoding failed:", error);
    process.exit(1);
  });
}
