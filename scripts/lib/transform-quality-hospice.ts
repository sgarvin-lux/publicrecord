import {
  type CmsRecord,
  type QualityMeasureRow,
  parseScore,
} from "./quality-measures";

function buildNationalMap(nationalRows: CmsRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of nationalRows) {
    const code = row.measure_code?.trim();
    const score = parseScore(row.score);
    if (code && score !== null) {
      map.set(code, score);
    }
  }
  return map;
}

function transformClaims(
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
      measure_name: row.measure_name?.trim() ?? null,
      score: parseScore(row.score),
      national_avg: null,
      state_avg: null,
      period: row.measure_date_range?.trim() ?? null,
      data_source: "cms-hospice-claims",
    });
  }
  return result;
}

function transformCahps(
  rows: CmsRecord[],
  nationalMap: Map<string, number>,
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
      measure_name: row.measure_name?.trim() ?? null,
      score: parseScore(row.score),
      national_avg: nationalMap.get(code) ?? null,
      state_avg: null,
      period: row.date?.trim() ?? null,
      data_source: "cms-hospice-cahps",
    });
  }
  return result;
}

export function transformQualityHospice(
  claimsRows: CmsRecord[],
  cahpsRows: CmsRecord[],
  nationalRows: CmsRecord[],
  lookup: Map<string, string>,
): QualityMeasureRow[] {
  const nationalMap = buildNationalMap(nationalRows);
  const claims = transformClaims(claimsRows, lookup);
  const cahps = transformCahps(cahpsRows, nationalMap, lookup);

  // Deduplicate by (provider_id, measure_code) — last-writer-wins
  // Claims and CAHPS use disjoint code namespaces, so collisions are unexpected.
  const merged = new Map<string, QualityMeasureRow>();
  for (const row of [...claims, ...cahps]) {
    const key = `${row.provider_id}:${row.measure_code}`;
    if (merged.has(key)) {
      console.warn(
        `Hospice measure code collision: ${row.measure_code} for provider ${row.provider_id}`,
      );
    }
    merged.set(key, row);
  }
  return [...merged.values()];
}
