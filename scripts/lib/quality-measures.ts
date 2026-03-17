export type CmsRecord = Record<string, string | undefined>;

export interface QualityMeasureRow {
  provider_id: string;
  measure_code: string;
  measure_name: string | null;
  score: number | null;
  national_avg: number | null;
  state_avg: number | null;
  period: string | null;
  data_source: string;
}

export function parseScore(value: string | undefined): number | null {
  if (!value || value.trim() === "" || value.trim() === "Not Available")
    return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}
