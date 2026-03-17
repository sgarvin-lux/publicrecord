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

    const code = row.measure_cd?.trim();
    if (!code) continue;

    const startDate = row.start_date?.trim();
    const endDate = row.end_date?.trim();
    const period = startDate && endDate ? `${startDate}-${endDate}` : null;

    result.push({
      provider_id: providerId,
      measure_code: code,
      measure_name: row.measure_description?.trim() ?? null,
      score: parseScore(row.score),
      national_avg: parseScore(row.national_rate),
      state_avg: parseScore(row.state_average),
      period,
      data_source: "cms-mds",
    });
  }
  return result;
}
