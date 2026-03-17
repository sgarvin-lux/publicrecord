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

describe("ingest-deficiencies pipeline", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("fetches, transforms, and upserts CMS deficiency records end-to-end", async () => {
    mockFetchAllPages.mockResolvedValue([
      {
        cms_certification_number_ccn: "015009",
        survey_date: "2023-03-02",
        deficiency_prefix: "F",
        deficiency_tag_number: "0880",
        deficiency_description: "Infection prevention program.",
        scope_severity_code: "F",
        deficiency_category: "Infection Control Deficiencies",
        correction_date: "2023-04-06",
      },
      {
        cms_certification_number_ccn: "015009",
        survey_date: "2023-03-02",
        deficiency_prefix: "K",
        deficiency_tag_number: "0321",
        deficiency_description: "Fire safety deficiency.",
        scope_severity_code: "D",
        deficiency_category: "Fire Safety",
        correction_date: "",
      },
      {
        cms_certification_number_ccn: "999999",
        survey_date: "2023-05-01",
        deficiency_prefix: "F",
        deficiency_tag_number: "0100",
        deficiency_description: "Unknown provider.",
        scope_severity_code: "G",
        deficiency_category: "Health",
        correction_date: "",
      },
    ]);

    // Mock provider resolution
    const mockIn = vi.fn().mockResolvedValue({
      data: [{ id: "uuid-abc-123", cms_id: "015009" }],
      error: null,
    });
    const mockSelect = vi.fn().mockReturnValue({ in: mockIn });

    // Capture upsert calls
    const upsertCalls: unknown[] = [];
    const mockUpsert = vi.fn().mockImplementation((batch: unknown[]) => {
      upsertCalls.push(batch);
      return Promise.resolve({
        error: null,
        count: (batch as unknown[]).length,
      });
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "providers")
        return { select: mockSelect } as unknown as ReturnType<
          typeof supabaseAdmin.from
        >;
      if (table === "deficiencies")
        return { upsert: mockUpsert } as unknown as ReturnType<
          typeof supabaseAdmin.from
        >;
      throw new Error(`Unexpected table: ${table}`);
    });

    const { main } = await import("../ingest-deficiencies");
    await main();

    // Verify CMS API was called with correct dataset
    expect(mockFetchAllPages).toHaveBeenCalledWith("r5ix-sfxw");

    // Verify provider lookup
    expect(mockSelect).toHaveBeenCalledWith("id, cms_id");

    // Verify upserts — record with CMS ID 999999 should be skipped
    const allUpserted = upsertCalls.flat();
    expect(allUpserted).toHaveLength(2);
    expect(allUpserted).toContainEqual({
      provider_id: "uuid-abc-123",
      survey_date: "2023-03-02",
      deficiency_tag: "F0880",
      deficiency_desc: "Infection prevention program.",
      scope_severity: "F",
      category: "Infection Control Deficiencies",
      corrected: true,
      correction_date: "2023-04-06",
    });
    expect(allUpserted).toContainEqual({
      provider_id: "uuid-abc-123",
      survey_date: "2023-03-02",
      deficiency_tag: "K0321",
      deficiency_desc: "Fire safety deficiency.",
      scope_severity: "D",
      category: "Fire Safety",
      corrected: false,
      correction_date: null,
    });

    // Verify upsert conflict key
    expect(mockUpsert).toHaveBeenCalledWith(expect.any(Array), {
      onConflict: "provider_id,survey_date,deficiency_tag",
      count: "exact",
    });
  });
});
