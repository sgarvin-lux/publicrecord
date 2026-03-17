import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAllPages } from "../cms-api";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchAllPages", () => {
  it("fetches a single page when count <= pageSize", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { id: "1", name: "Record 1" },
          { id: "2", name: "Record 2" },
        ],
        count: 2,
      }),
    });

    const results = await fetchAllPages("test-dataset", 1000);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: "1", name: "Record 1" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("test-dataset"),
      expect.any(Object),
    );
  });

  it("paginates across multiple pages", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ id: "1" }, { id: "2" }],
          count: 3,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ id: "3" }],
          count: 3,
        }),
      });

    const results = await fetchAllPages("test-dataset", 2);

    expect(results).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on failure and succeeds", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ id: "1" }],
          count: 1,
        }),
      });

    const results = await fetchAllPages("test-dataset", 1000);

    expect(results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after max retries exhausted", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    await expect(fetchAllPages("test-dataset", 1000)).rejects.toThrow(
      "Network error",
    );
    // 1 initial + 3 retries = 4 calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("throws on non-ok HTTP response after retries", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(fetchAllPages("test-dataset", 1000)).rejects.toThrow("500");
    // 1 initial + 3 retries = 4 calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
