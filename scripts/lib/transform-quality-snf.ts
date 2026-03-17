import {
  type CmsRecord,
  type QualityMeasureRow,
  parseScore,
} from "./quality-measures";

export function transformQualitySnf(
  rows: CmsRecord[],
  lookup: Map<string, string>,
): QualityMeasureRow[] {
  const result: QualityMeasureRow[] = [];
  for (const row of rows) {
    const ccn = row.cms_certification_number_ccn?.trim();
    if (!ccn) continue;
    const providerId = lookup.get(ccn);
    if (!providerId) continue;

    const code = row.measure_code?.trim();
    if (!code) continue;

    result.push({
      provider_id: providerId,
      measure_code: code,
      measure_name: row.measure_description?.trim() ?? null,
      score: parseScore(row.four_quarter_average_score),
      national_avg: null,
      state_avg: null,
      period: row.measure_period?.trim() ?? null,
      data_source: "cms-mds",
    });
  }
  return result;
}
