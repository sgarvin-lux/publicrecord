import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("../lib/mapbox-geocode", () => ({
  geocodeAddress: vi.fn(),
}));

import { supabaseAdmin } from "../lib/supabase-admin";
import { geocodeAddress } from "../lib/mapbox-geocode";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGeocodeAddress = vi.mocked(geocodeAddress);

describe("geocode-providers pipeline", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.MAPBOX_ACCESS_TOKEN = "test-token";
  });

  it("fetches providers without lat, geocodes them, and updates", async () => {
    // First call returns providers, second returns empty (no more)
    let selectCallCount = 0;
    const mockLimit = vi.fn().mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return Promise.resolve({
          data: [
            {
              id: "uuid-1",
              address: "123 Main St",
              city: "Birmingham",
              state: "AL",
              zip: "35203",
            },
            {
              id: "uuid-2",
              address: "456 Oak Ave",
              city: "Montgomery",
              state: "AL",
              zip: "36104",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const mockNot = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockIs = vi.fn().mockReturnValue({ not: mockNot });
    const mockSelect = vi.fn().mockReturnValue({ is: mockIs });

    // Track update calls
    const updateCalls: Array<{ id: string; lat: number; lng: number }> = [];
    const mockEq = vi.fn().mockImplementation((field: string, id: string) => {
      void field;
      void id;
      return Promise.resolve({ error: null });
    });
    const mockUpdate = vi
      .fn()
      .mockImplementation((data: { lat: number; lng: number }) => {
        updateCalls.push({ ...data, id: "" });
        return { eq: mockEq };
      });

    mockFrom.mockImplementation((table: string) => {
      if (table === "providers") {
        return {
          select: mockSelect,
          update: mockUpdate,
        } as unknown as ReturnType<typeof supabaseAdmin.from>;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    // Mock geocoding results
    mockGeocodeAddress
      .mockResolvedValueOnce({ lat: 33.5186, lng: -86.8104 })
      .mockResolvedValueOnce({ lat: 32.3668, lng: -86.3 });

    const { main } = await import("../geocode-providers");
    await main();

    // Verify geocoding was called for each provider
    expect(mockGeocodeAddress).toHaveBeenCalledTimes(2);
    expect(mockGeocodeAddress).toHaveBeenCalledWith(
      expect.objectContaining({ id: "uuid-1", address: "123 Main St" }),
      "test-token",
    );

    // Verify updates were made
    expect(mockUpdate).toHaveBeenCalledWith({
      lat: 33.5186,
      lng: -86.8104,
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      lat: 32.3668,
      lng: -86.3,
    });
  });
});
