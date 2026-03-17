import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the CMS API client
vi.mock("../lib/cms-api", () => ({
  fetchAllPages: vi.fn(),
}));

// Mock the Supabase admin client
vi.mock("../lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { fetchAllPages } from "../lib/cms-api";
import { supabaseAdmin } from "../lib/supabase-admin";

const mockFetchAllPages = vi.mocked(fetchAllPages);
const mockFrom = vi.mocked(supabaseAdmin.from);

describe("ingest-penalties pipeline", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("fetches, transforms, and upserts CMS penalty records end-to-end", async () => {
    // Mock CMS API response
    mockFetchAllPages.mockResolvedValue([
      {
        cms_certification_number_ccn: "015001",
        penalty_date: "03/15/2025",
        penalty_type: "Fine",
        fine_amount: "5000",
        payment_denial_start_date: "",
        payment_denial_length_in_days: "",
      },
      {
        cms_certification_number_ccn: "015001",
        penalty_date: "04/01/2025",
        penalty_type: "Payment Denial",
        fine_amount: "",
        payment_denial_start_date: "04/05/2025",
        payment_denial_length_in_days: "30",
      },
      {
        cms_certification_number_ccn: "999999",
        penalty_date: "05/01/2025",
        penalty_type: "Fine",
        fine_amount: "1000",
        payment_denial_start_date: "",
        payment_denial_length_in_days: "",
      },
    ]);

    // Mock provider resolution
    const mockIn = vi.fn().mockResolvedValue({
      data: [{ id: "uuid-abc-123", cms_id: "015001" }],
      error: null,
    });
    const mockSelect = vi.fn().mockReturnValue({ in: mockIn });

    // Capture upsert calls to verify payloads
    const upsertCalls: unknown[] = [];
    const mockUpsert = vi.fn().mockImplementation((batch: unknown[]) => {
      upsertCalls.push(batch);
      return Promise.resolve({ error: null, count: batch.length });
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "providers")
        return { select: mockSelect } as unknown as ReturnType<
          typeof supabaseAdmin.from
        >;
      if (table === "penalties")
        return { upsert: mockUpsert } as unknown as ReturnType<
          typeof supabaseAdmin.from
        >;
      throw new Error(`Unexpected table: ${table}`);
    });

    // Import and run main
    const { main } = await import("../ingest-penalties");
    await main();

    // Verify CMS API was called with correct dataset
    expect(mockFetchAllPages).toHaveBeenCalledWith("g6vv-u9sr");

    // Verify provider lookup was called
    expect(mockSelect).toHaveBeenCalledWith("id, cms_id");

    // Verify upsert was called with transformed records
    // Record with CMS ID 999999 should be skipped (not in provider map)
    const allUpserted = upsertCalls.flat();
    expect(allUpserted).toHaveLength(2);
    expect(allUpserted).toContainEqual({
      provider_id: "uuid-abc-123",
      penalty_date: "2025-03-15",
      penalty_type: "Fine",
      amount: 5000,
      description: "Civil money penalty: $5,000",
    });
    expect(allUpserted).toContainEqual({
      provider_id: "uuid-abc-123",
      penalty_date: "2025-04-01",
      penalty_type: "Payment Denial",
      amount: 0,
      description: "Payment denial: 30 days starting 2025-04-05",
    });
  });
});
