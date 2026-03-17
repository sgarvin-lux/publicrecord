type CmsRecord = Record<string, string | undefined>;

export interface ProviderRow {
  cms_id: string;
  name: string;
  provider_type: "nursing_home" | "home_health" | "hospice";
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  ownership_type: string | null;
  star_rating_overall: number | null;
  star_rating_health: number | null;
  star_rating_staffing: number | null;
  star_rating_quality: number | null;
  lat: number | null;
  lng: number | null;
}

function parseRating(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) || parsed < 1 || parsed > 5 ? null : parsed;
}

function parseCoord(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function normalizePhone(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) return value.trim() || null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function trimOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function transformNursingHome(raw: CmsRecord): ProviderRow | null {
  const cmsId = trimOrNull(raw.cms_certification_number_ccn);
  const name = trimOrNull(raw.provider_name);
  if (!cmsId || !name) return null;

  return {
    cms_id: cmsId,
    name,
    provider_type: "nursing_home",
    address: trimOrNull(raw.provider_address),
    city: trimOrNull(raw.citytown),
    state: trimOrNull(raw.state),
    zip: trimOrNull(raw.zip_code),
    phone: normalizePhone(raw.telephone_number),
    ownership_type: trimOrNull(raw.ownership_type),
    star_rating_overall: parseRating(raw.overall_rating),
    star_rating_health: parseRating(raw.health_inspection_rating),
    star_rating_staffing: parseRating(raw.staffing_rating),
    star_rating_quality: parseRating(raw.qm_rating),
    lat: parseCoord(raw.latitude),
    lng: parseCoord(raw.longitude),
  };
}

export function transformHomeHealth(raw: CmsRecord): ProviderRow | null {
  const cmsId = trimOrNull(raw.cms_certification_number_ccn);
  const name = trimOrNull(raw.provider_name);
  if (!cmsId || !name) return null;

  return {
    cms_id: cmsId,
    name,
    provider_type: "home_health",
    address: trimOrNull(raw.address),
    city: trimOrNull(raw.citytown),
    state: trimOrNull(raw.state),
    zip: trimOrNull(raw.zip_code),
    phone: normalizePhone(raw.telephone_number),
    ownership_type: trimOrNull(raw.type_of_ownership),
    star_rating_overall: null,
    star_rating_health: null,
    star_rating_staffing: null,
    star_rating_quality: parseRating(raw.quality_of_patient_care_star_rating),
    lat: null,
    lng: null,
  };
}

export function transformHospice(raw: CmsRecord): ProviderRow | null {
  const cmsId = trimOrNull(raw.cms_certification_number_ccn);
  const name = trimOrNull(raw.facility_name);
  if (!cmsId || !name) return null;

  return {
    cms_id: cmsId,
    name,
    provider_type: "hospice",
    address: trimOrNull(raw.address_line_1),
    city: trimOrNull(raw.citytown),
    state: trimOrNull(raw.state),
    zip: trimOrNull(raw.zip_code),
    phone: normalizePhone(raw.telephone_number),
    ownership_type: null,
    star_rating_overall: null,
    star_rating_health: null,
    star_rating_staffing: null,
    star_rating_quality: null,
    lat: null,
    lng: null,
  };
}

export interface DatasetConfig {
  datasetId: string;
  providerType: "nursing_home" | "home_health" | "hospice";
  transform: (raw: CmsRecord) => ProviderRow | null;
}

export const DATASETS: DatasetConfig[] = [
  {
    datasetId: "4pq5-n9py",
    providerType: "nursing_home",
    transform: transformNursingHome,
  },
  {
    datasetId: "6jpm-sxkc",
    providerType: "home_health",
    transform: transformHomeHealth,
  },
  {
    datasetId: "252m-zfp9",
    providerType: "hospice",
    transform: transformHospice,
  },
];
