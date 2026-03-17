import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/cms-api", () => ({
  fetchAllPages: vi.fn(),
}));

vi.mock("../lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { fetchAllPages } from "../lib/cms-api";
import { supabaseAdmin } from "../lib/supabase-admin";

const mockFetchAllPages = vi.mocked(fetchAllPages);
const mockFrom = vi.mocked(supabaseAdmin.from);

describe("ingest-providers pipeline", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("fetches all 3 datasets, transforms, deduplicates, and upserts", async () => {
    // Mock CMS API responses for each dataset
    mockFetchAllPages.mockImplementation(async (datasetId: string) => {
      if (datasetId === "4pq5-n9py") {
        // Nursing homes
        return [
          {
            cms_certification_number_ccn: "015001",
            provider_name: "Sunny Acres",
            provider_address: "123 Main St",
            citytown: "Birmingham",
            state: "AL",
            zip_code: "35203",
            telephone_number: "2055551234",
            ownership_type: "For profit - Corporation",
            overall_rating: "4",
            health_inspection_rating: "3",
            staffing_rating: "5",
            qm_rating: "4",
            latitude: "33.5186",
            longitude: "-86.8104",
          },
        ];
      }
      if (datasetId === "6jpm-sxkc") {
        // Home health
        return [
          {
            cms_certification_number_ccn: "017001",
            provider_name: "Care At Home",
            address: "456 Oak Ave",
            citytown: "Montgomery",
            state: "AL",
            zip_code: "36104",
            telephone_number: "3345559876",
            type_of_ownership: "Proprietary",
            quality_of_patient_care_star_rating: "3",
          },
        ];
      }
      if (datasetId === "252m-zfp9") {
        // Hospice — multiple rows for same provider (measures dataset)
        return [
          {
            cms_certification_number_ccn: "011500",
            facility_name: "Comfort Hospice",
            address_line_1: "789 Elm Blvd",
            citytown: "Huntsville",
            state: "AL",
            zip_code: "35801",
            telephone_number: "2565554321",
            measure_code: "H-001",
            score: "95",
          },
          {
            cms_certification_number_ccn: "011500",
            facility_name: "Comfort Hospice",
            address_line_1: "789 Elm Blvd",
            citytown: "Huntsville",
            state: "AL",
            zip_code: "35801",
            telephone_number: "2565554321",
            measure_code: "H-002",
            score: "88",
          },
        ];
      }
      return [];
    });

    // Capture upsert calls
    const upsertCalls: unknown[] = [];
    const mockUpsert = vi.fn().mockImplementation((batch: unknown[]) => {
      upsertCalls.push(batch);
      return Promise.resolve({
        error: null,
        count: (batch as unknown[]).length,
      });
    });

    mockFrom.mockImplementation(() => {
      return { upsert: mockUpsert } as unknown as ReturnType<
        typeof supabaseAdmin.from
      >;
    });

    const { main } = await import("../ingest-providers");
    await main();

    // Verify all 3 datasets were fetched
    expect(mockFetchAllPages).toHaveBeenCalledWith("4pq5-n9py");
    expect(mockFetchAllPages).toHaveBeenCalledWith("6jpm-sxkc");
    expect(mockFetchAllPages).toHaveBeenCalledWith("252m-zfp9");

    // Verify upserts — hospice should be deduplicated from 2 rows to 1
    const allUpserted = upsertCalls.flat() as Array<Record<string, unknown>>;
    expect(allUpserted).toHaveLength(3);

    // Nursing home
    expect(allUpserted).toContainEqual(
      expect.objectContaining({
        cms_id: "015001",
        name: "Sunny Acres",
        provider_type: "nursing_home",
        star_rating_overall: 4,
      }),
    );

    // Home health
    expect(allUpserted).toContainEqual(
      expect.objectContaining({
        cms_id: "017001",
        name: "Care At Home",
        provider_type: "home_health",
        star_rating_quality: 3,
      }),
    );

    // Hospice (deduplicated)
    expect(allUpserted).toContainEqual(
      expect.objectContaining({
        cms_id: "011500",
        name: "Comfort Hospice",
        provider_type: "hospice",
      }),
    );

    // Verify upsert was called on providers table with cms_id conflict
    expect(mockUpsert).toHaveBeenCalledWith(expect.any(Array), {
      onConflict: "cms_id",
      count: "exact",
    });
  });
});
