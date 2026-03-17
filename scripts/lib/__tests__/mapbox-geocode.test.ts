import { describe, it, expect, vi, beforeEach } from "vitest";
import { geocodeAddress, buildAddress } from "../mapbox-geocode";

describe("buildAddress", () => {
  it("joins all parts with commas", () => {
    expect(
      buildAddress({
        address: "123 Main St",
        city: "Birmingham",
        state: "AL",
        zip: "35203",
      }),
    ).toBe("123 Main St, Birmingham, AL, 35203");
  });

  it("skips null parts", () => {
    expect(
      buildAddress({
        address: "123 Main St",
        city: null,
        state: "AL",
        zip: null,
      }),
    ).toBe("123 Main St, AL");
  });

  it("returns null when all parts are null", () => {
    expect(
      buildAddress({ address: null, city: null, state: null, zip: null }),
    ).toBeNull();
  });
});

describe("geocodeAddress", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns lat/lng from Mapbox response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        features: [{ center: [-86.8104, 33.5186] }],
      }),
    } as Response);

    const result = await geocodeAddress(
      {
        address: "123 Main St",
        city: "Birmingham",
        state: "AL",
        zip: "35203",
      },
      "test-token",
    );

    expect(result).toEqual({ lat: 33.5186, lng: -86.8104 });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("access_token=test-token"),
    );
  });

  it("returns null when no features found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ features: [] }),
    } as Response);

    const result = await geocodeAddress(
      { address: "Nowhere", city: null, state: null, zip: null },
      "test-token",
    );

    expect(result).toBeNull();
  });

  it("returns null when address is all nulls", async () => {
    const result = await geocodeAddress(
      { address: null, city: null, state: null, zip: null },
      "test-token",
    );

    expect(result).toBeNull();
  });

  it("retries on rate limit (429)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          features: [{ center: [-86.8, 33.5] }],
        }),
      } as Response);

    const result = await geocodeAddress(
      { address: "123 Main St", city: "Birmingham", state: "AL", zip: "35203" },
      "test-token",
    );

    expect(result).toEqual({ lat: 33.5, lng: -86.8 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      geocodeAddress(
        {
          address: "123 Main St",
          city: "Birmingham",
          state: "AL",
          zip: "35203",
        },
        "test-token",
      ),
    ).rejects.toThrow("Mapbox API returned 500");

    expect(fetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });
});
