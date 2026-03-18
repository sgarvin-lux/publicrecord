import { describe, it, expect } from "vitest";
import { transformQualitySnf } from "../transform-quality-snf";

const lookup = new Map([["015001", "uuid-provider-1"]]);

describe("transformQualitySnf", () => {
  const baseRow = {
    cms_certification_number_ccn: "015001",
    measure_code: "401",
    measure_description:
      "Percent of long-stay residents who received an antipsychotic",
    four_quarter_average_score: "14.5",
    measure_period: "2024Q4-2025Q3",
  };

  it("transforms a complete SNF quality measure row", () => {
    const result = transformQualitySnf([baseRow], lookup);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      provider_id: "uuid-provider-1",
      measure_code: "401",
      measure_name:
        "Percent of long-stay residents who received an antipsychotic",
      score: 14.5,
      national_avg: null,
      state_avg: null,
      period: "2024Q4-2025Q3",
      data_source: "cms-mds",
    });
  });

  it("skips rows with unknown CCN", () => {
    const result = transformQualitySnf(
      [{ ...baseRow, cms_certification_number_ccn: "UNKNOWN" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("skips rows with empty CCN", () => {
    const result = transformQualitySnf(
      [{ ...baseRow, cms_certification_number_ccn: "" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("returns null score for 'Not Available'", () => {
    const result = transformQualitySnf(
      [{ ...baseRow, four_quarter_average_score: "Not Available" }],
      lookup,
    );
    expect(result[0].score).toBeNull();
  });

  it("returns null score for empty string", () => {
    const result = transformQualitySnf(
      [{ ...baseRow, four_quarter_average_score: "" }],
      lookup,
    );
    expect(result[0].score).toBeNull();
  });

  it("returns null period when measure_period is undefined", () => {
    const { measure_period: _, ...rowWithoutPeriod } = baseRow;
    const result = transformQualitySnf([rowWithoutPeriod], lookup);
    expect(result[0].period).toBeNull();
  });

  it("always returns null for national_avg and state_avg", () => {
    const result = transformQualitySnf([baseRow], lookup);
    expect(result[0].national_avg).toBeNull();
    expect(result[0].state_avg).toBeNull();
  });

  it("skips rows with empty measure_code", () => {
    const result = transformQualitySnf(
      [{ ...baseRow, measure_code: "" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });
});
