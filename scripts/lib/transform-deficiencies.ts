type CmsRecord = Record<string, string | undefined>;

export interface DeficiencyRow {
  provider_id: string;
  survey_date: string;
  deficiency_tag: string;
  deficiency_desc: string | null;
  scope_severity: string | null;
  category: string | null;
  corrected: boolean;
  correction_date: string | null;
}

function trimOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function composeDeficiencyTag(
  prefix: string | undefined,
  tagNumber: string | undefined,
): string | null {
  const p = prefix?.trim();
  const t = tagNumber?.trim();
  if (!p || !t) return null;
  return `${p}${t}`;
}

export function transformDeficiencyRecord(
  raw: CmsRecord,
  providerMap: Map<string, string>,
): DeficiencyRow | null {
  const cmsId = raw.cms_certification_number_ccn?.trim();
  const surveyDate = raw.survey_date?.trim();
  const tag = composeDeficiencyTag(
    raw.deficiency_prefix,
    raw.deficiency_tag_number,
  );

  if (!cmsId || !surveyDate || !tag) return null;

  const providerId = providerMap.get(cmsId);
  if (!providerId) return null;

  const correctionDate = trimOrNull(raw.correction_date);

  return {
    provider_id: providerId,
    survey_date: surveyDate,
    deficiency_tag: tag,
    deficiency_desc: trimOrNull(raw.deficiency_description),
    scope_severity: trimOrNull(raw.scope_severity_code),
    category: trimOrNull(raw.deficiency_category),
    corrected: correctionDate !== null,
    correction_date: correctionDate,
  };
}
