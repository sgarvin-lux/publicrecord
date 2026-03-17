import { describe, it, expect } from "vitest";
import {
  composeDeficiencyTag,
  transformDeficiencyRecord,
} from "../transform-deficiencies";

describe("composeDeficiencyTag", () => {
  it("combines prefix and tag number", () => {
    expect(composeDeficiencyTag("F", "0880")).toBe("F0880");
  });

  it("handles K-tag for fire safety", () => {
    expect(composeDeficiencyTag("K", "0321")).toBe("K0321");
  });

  it("returns null when prefix is missing", () => {
    expect(composeDeficiencyTag("", "0880")).toBeNull();
  });

  it("returns null when tag number is missing", () => {
    expect(composeDeficiencyTag("F", "")).toBeNull();
  });

  it("returns null when both are undefined", () => {
    expect(composeDeficiencyTag(undefined, undefined)).toBeNull();
  });
});

describe("transformDeficiencyRecord", () => {
  const providerMap = new Map([["015009", "uuid-abc-123"]]);

  const baseRecord = {
    cms_certification_number_ccn: "015009",
    survey_date: "2023-03-02",
    deficiency_prefix: "F",
    deficiency_tag_number: "0880",
    deficiency_description:
      "Provide and implement an infection prevention and control program.",
    scope_severity_code: "F",
    deficiency_category: "Infection Control Deficiencies",
    correction_date: "2023-04-06",
  };

  it("transforms a complete deficiency record", () => {
    const result = transformDeficiencyRecord(baseRecord, providerMap);
    expect(result).toEqual({
      provider_id: "uuid-abc-123",
      survey_date: "2023-03-02",
      deficiency_tag: "F0880",
      deficiency_desc:
        "Provide and implement an infection prevention and control program.",
      scope_severity: "F",
      category: "Infection Control Deficiencies",
      corrected: true,
      correction_date: "2023-04-06",
    });
  });

  it("sets corrected to false when correction_date is absent", () => {
    const result = transformDeficiencyRecord(
      { ...baseRecord, correction_date: "" },
      providerMap,
    );
    expect(result!.corrected).toBe(false);
    expect(result!.correction_date).toBeNull();
  });

  it("returns null when CMS ID is not in provider map", () => {
    const result = transformDeficiencyRecord(
      { ...baseRecord, cms_certification_number_ccn: "999999" },
      providerMap,
    );
    expect(result).toBeNull();
  });

  it("returns null when survey_date is missing", () => {
    const result = transformDeficiencyRecord(
      { ...baseRecord, survey_date: "" },
      providerMap,
    );
    expect(result).toBeNull();
  });

  it("returns null when deficiency tag cannot be composed", () => {
    const result = transformDeficiencyRecord(
      { ...baseRecord, deficiency_prefix: "", deficiency_tag_number: "" },
      providerMap,
    );
    expect(result).toBeNull();
  });

  it("returns null when CMS ID is missing", () => {
    const result = transformDeficiencyRecord(
      { ...baseRecord, cms_certification_number_ccn: "" },
      providerMap,
    );
    expect(result).toBeNull();
  });

  it("handles missing optional fields gracefully", () => {
    const result = transformDeficiencyRecord(
      {
        cms_certification_number_ccn: "015009",
        survey_date: "2023-03-02",
        deficiency_prefix: "F",
        deficiency_tag_number: "0880",
      },
      providerMap,
    );
    expect(result).toEqual({
      provider_id: "uuid-abc-123",
      survey_date: "2023-03-02",
      deficiency_tag: "F0880",
      deficiency_desc: null,
      scope_severity: null,
      category: null,
      corrected: false,
      correction_date: null,
    });
  });
});
