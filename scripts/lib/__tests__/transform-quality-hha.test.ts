import { describe, it, expect } from "vitest";
import { transformQualityHha } from "../transform-quality-hha";

const lookup = new Map([["123456", "uuid-hha-1"]]);

const sampleProviderRow = {
  cms_certification_number_ccn: "123456",
  quality_of_patient_care_star_rating: "4.5",
  dtc_riskstandardized_rate: "89.38",
  pph_riskstandardized_rate: "7.64",
  covid19_vaccine_percent_of_patients_who_are_up_to_date: "32.91",
  how_much_medicare_spends_on_an_episode_of_care_at_this_agen_56e6: "0.94",
};

const sampleNationalRow = {
  quality_of_patient_care_star_rating: "3",
  dtc_national_observed_rate: "77.71",
  pph_national_observed_rate: "10.83",
  covid19_vaccine_percent_of_patients_who_are_up_to_date: "54.12",
  how_much_medicare_spends_on_an_episode_of_care_at_this_agen_56e6: "1.00",
};

describe("transformQualityHha", () => {
  it("produces one row per HHA_MEASURES entry per provider", () => {
    const result = transformQualityHha(
      [sampleProviderRow],
      sampleNationalRow,
      lookup,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.provider_id === "uuid-hha-1")).toBe(true);
    expect(result.every((r) => r.data_source === "cms-hha")).toBe(true);
    expect(result.every((r) => r.state_avg === null)).toBe(true);
    expect(result.every((r) => r.period === null)).toBe(true);
  });

  it("joins national averages correctly for DTC measure", () => {
    const result = transformQualityHha(
      [sampleProviderRow],
      sampleNationalRow,
      lookup,
    );
    const dtcRow = result.find((r) => r.measure_code === "HHA_DTC");
    expect(dtcRow).toBeDefined();
    expect(dtcRow?.score).toBe(89.38);
    expect(dtcRow?.national_avg).toBe(77.71);
  });

  it("sets national_avg to null for all rows when nationalRow is null", () => {
    const result = transformQualityHha([sampleProviderRow], null, lookup);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.national_avg === null)).toBe(true);
  });

  it("skips rows with unknown CCN", () => {
    const result = transformQualityHha(
      [{ ...sampleProviderRow, cms_certification_number_ccn: "UNKNOWN" }],
      sampleNationalRow,
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("handles missing measure value as null score", () => {
    const rowWithMissingScore = {
      ...sampleProviderRow,
      dtc_riskstandardized_rate: "",
    };
    const result = transformQualityHha(
      [rowWithMissingScore],
      sampleNationalRow,
      lookup,
    );
    const dtcRow = result.find((r) => r.measure_code === "HHA_DTC");
    expect(dtcRow?.score).toBeNull();
  });
});
