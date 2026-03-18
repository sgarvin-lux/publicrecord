import { describe, it, expect } from "vitest";
import { transformQualityHospice } from "../transform-quality-hospice";

const lookup = new Map([["999001", "uuid-hospice-1"]]);

const sampleClaimsRow = {
  cms_certification_number_ccn: "999001",
  measure_code: "H_001_01_OBSERVED",
  measure_name: "Hospice and Palliative Care - Pain Screening",
  score: "87.5",
  measure_date_range: "04/01/2024-03/31/2025",
};

const sampleCahpsRow = {
  cms_certification_number_ccn: "999001",
  measure_code: "EMO_REL_BBV",
  measure_name: "Emotional and Spiritual Support - Bottom Box",
  score: "11.3",
  date: "04/01/2023-03/31/2025",
};

const sampleCahpsNationalRow = {
  measure_code: "EMO_REL_BBV",
  measure_name: "Emotional and Spiritual Support - Bottom Box",
  score: "12.1",
};

describe("transformQualityHospice", () => {
  it("transforms claims rows with null national_avg", () => {
    const result = transformQualityHospice([sampleClaimsRow], [], [], lookup);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider_id: "uuid-hospice-1",
      measure_code: "H_001_01_OBSERVED",
      score: 87.5,
      national_avg: null,
      period: "04/01/2024-03/31/2025",
      data_source: "cms-hospice-claims",
    });
  });

  it("transforms CAHPS rows and joins national avg from nationalRows", () => {
    const result = transformQualityHospice(
      [],
      [sampleCahpsRow],
      [sampleCahpsNationalRow],
      lookup,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      measure_code: "EMO_REL_BBV",
      score: 11.3,
      national_avg: 12.1,
      period: "04/01/2023-03/31/2025",
      data_source: "cms-hospice-cahps",
    });
  });

  it("sets CAHPS national_avg to null when measure_code not in national rows", () => {
    const result = transformQualityHospice(
      [],
      [sampleCahpsRow],
      [], // empty national rows
      lookup,
    );
    expect(result[0].national_avg).toBeNull();
  });

  it("skips rows with unknown CCN", () => {
    const result = transformQualityHospice(
      [{ ...sampleClaimsRow, cms_certification_number_ccn: "UNKNOWN" }],
      [],
      [],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("merges claims and CAHPS rows with disjoint measure codes", () => {
    const result = transformQualityHospice(
      [sampleClaimsRow],
      [sampleCahpsRow],
      [sampleCahpsNationalRow],
      lookup,
    );
    expect(result).toHaveLength(2);
    const codes = result.map((r) => r.measure_code);
    expect(codes).toContain("H_001_01_OBSERVED");
    expect(codes).toContain("EMO_REL_BBV");
  });

  it("handles 'Not Available' score as null", () => {
    const result = transformQualityHospice(
      [{ ...sampleClaimsRow, score: "Not Available" }],
      [],
      [],
      lookup,
    );
    expect(result[0].score).toBeNull();
  });

  it("skips claims rows with missing measure_code", () => {
    const result = transformQualityHospice(
      [{ ...sampleClaimsRow, measure_code: "" }],
      [],
      [],
      lookup,
    );
    expect(result).toHaveLength(0);
  });
});
