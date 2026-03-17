import { describe, it, expect } from "vitest";
import { transformQualitySnf } from "../transform-quality-snf";

const lookup = new Map([["015001", "uuid-provider-1"]]);

describe("transformQualitySnf", () => {
  const baseRow = {
    cms_certification_number_ccn: "015001",
    measure_cd: "NH_QM_001",
    measure_description: "Percent of long-stay residents who received an antipsychotic",
    score: "14.5",
    national_rate: "15.2",
    state_average: "13.8",
    start_date: "04/01/2024",
    end_date: "03/31/2025",
  };

  it("transforms a complete SNF quality measure row", () => {
    const result = transformQualitySnf([baseRow], lookup);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      provider_id: "uuid-provider-1",
      measure_code: "NH_QM_001",
      measure_name: "Percent of long-stay residents who received an antipsychotic",
      score: 14.5,
      national_avg: 15.2,
      state_avg: 13.8,
      period: "04/01/2024-03/31/2025",
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
    const result = transformQualitySnf([{ ...baseRow, score: "Not Available" }], lookup);
    expect(result[0].score).toBeNull();
  });

  it("returns null score for empty string", () => {
    const result = transformQualitySnf([{ ...baseRow, score: "" }], lookup);
    expect(result[0].score).toBeNull();
  });

  it("returns null period when start_date is empty", () => {
    const result = transformQualitySnf([{ ...baseRow, start_date: "" }], lookup);
    expect(result[0].period).toBeNull();
  });

  it("returns null period when end_date is undefined", () => {
    const { end_date: _, ...rowWithoutEnd } = baseRow;
    const result = transformQualitySnf([rowWithoutEnd], lookup);
    expect(result[0].period).toBeNull();
  });

  it("returns null national_avg when national_rate is empty", () => {
    const result = transformQualitySnf([{ ...baseRow, national_rate: "" }], lookup);
    expect(result[0].national_avg).toBeNull();
  });
});
