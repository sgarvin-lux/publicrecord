import { describe, it, expect } from "vitest";
import {
  transformNursingHome,
  transformHomeHealth,
  transformHospice,
} from "../transform-providers";

describe("transformNursingHome", () => {
  const baseRecord = {
    cms_certification_number_ccn: "015001",
    provider_name: "Sunny Acres Nursing Home",
    provider_address: "123 Main St",
    citytown: "Birmingham",
    state: "AL",
    zip_code: "35203",
    telephone_number: "2055551234",
    ownership_type: "For profit - Corporation",
    overall_rating: "4",
    health_inspection_rating: "3",
    staffing_rating: "5",
    qm_rating: "4",
    latitude: "33.5186",
    longitude: "-86.8104",
  };

  it("transforms a complete nursing home record", () => {
    const result = transformNursingHome(baseRecord);
    expect(result).toEqual({
      cms_id: "015001",
      name: "Sunny Acres Nursing Home",
      provider_type: "nursing_home",
      address: "123 Main St",
      city: "Birmingham",
      state: "AL",
      zip: "35203",
      phone: "(205) 555-1234",
      ownership_type: "For profit - Corporation",
      star_rating_overall: 4,
      star_rating_health: 3,
      star_rating_staffing: 5,
      star_rating_quality: 4,
      lat: 33.5186,
      lng: -86.8104,
    });
  });

  it("returns null when cms_id is missing", () => {
    expect(
      transformNursingHome({ ...baseRecord, cms_certification_number_ccn: "" }),
    ).toBeNull();
  });

  it("returns null when provider_name is missing", () => {
    expect(
      transformNursingHome({ ...baseRecord, provider_name: "" }),
    ).toBeNull();
  });

  it("handles missing optional fields gracefully", () => {
    const result = transformNursingHome({
      cms_certification_number_ccn: "015001",
      provider_name: "Test Home",
    });
    expect(result).toEqual({
      cms_id: "015001",
      name: "Test Home",
      provider_type: "nursing_home",
      address: null,
      city: null,
      state: null,
      zip: null,
      phone: null,
      ownership_type: null,
      star_rating_overall: null,
      star_rating_health: null,
      star_rating_staffing: null,
      star_rating_quality: null,
      lat: null,
      lng: null,
    });
  });

  it("rejects ratings outside 1-5 range", () => {
    const result = transformNursingHome({
      ...baseRecord,
      overall_rating: "0",
      health_inspection_rating: "6",
      staffing_rating: "abc",
    });
    expect(result!.star_rating_overall).toBeNull();
    expect(result!.star_rating_health).toBeNull();
    expect(result!.star_rating_staffing).toBeNull();
  });

  it("normalizes 10-digit phone numbers", () => {
    const result = transformNursingHome({
      ...baseRecord,
      telephone_number: "205-555-1234",
    });
    expect(result!.phone).toBe("(205) 555-1234");
  });
});

describe("transformHomeHealth", () => {
  const baseRecord = {
    cms_certification_number_ccn: "017001",
    provider_name: "Care At Home LLC",
    address: "456 Oak Ave",
    citytown: "Montgomery",
    state: "AL",
    zip_code: "36104",
    telephone_number: "3345559876",
    type_of_ownership: "Proprietary",
    quality_of_patient_care_star_rating: "3",
  };

  it("transforms a complete home health record", () => {
    const result = transformHomeHealth(baseRecord);
    expect(result).toEqual({
      cms_id: "017001",
      name: "Care At Home LLC",
      provider_type: "home_health",
      address: "456 Oak Ave",
      city: "Montgomery",
      state: "AL",
      zip: "36104",
      phone: "(334) 555-9876",
      ownership_type: "Proprietary",
      star_rating_overall: null,
      star_rating_health: null,
      star_rating_staffing: null,
      star_rating_quality: 3,
      lat: null,
      lng: null,
    });
  });

  it("returns null when cms_id is missing", () => {
    expect(
      transformHomeHealth({ ...baseRecord, cms_certification_number_ccn: "" }),
    ).toBeNull();
  });
});

describe("transformHospice", () => {
  const baseRecord = {
    cms_certification_number_ccn: "011500",
    facility_name: "Comfort Hospice Care",
    address_line_1: "789 Elm Blvd",
    citytown: "Huntsville",
    state: "AL",
    zip_code: "35801",
    telephone_number: "2565554321",
  };

  it("transforms a complete hospice record", () => {
    const result = transformHospice(baseRecord);
    expect(result).toEqual({
      cms_id: "011500",
      name: "Comfort Hospice Care",
      provider_type: "hospice",
      address: "789 Elm Blvd",
      city: "Huntsville",
      state: "AL",
      zip: "35801",
      phone: "(256) 555-4321",
      ownership_type: null,
      star_rating_overall: null,
      star_rating_health: null,
      star_rating_staffing: null,
      star_rating_quality: null,
      lat: null,
      lng: null,
    });
  });

  it("returns null when facility_name is missing", () => {
    expect(transformHospice({ ...baseRecord, facility_name: "" })).toBeNull();
  });

  it("returns null when cms_id is missing", () => {
    expect(
      transformHospice({ ...baseRecord, cms_certification_number_ccn: "" }),
    ).toBeNull();
  });
});
