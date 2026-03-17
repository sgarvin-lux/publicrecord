const CMS_API_BASE = "https://data.cms.gov/provider-data/api/1/datastore/query";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

async function fetchPage(
  datasetId: string,
  offset: number,
  limit: number,
): Promise<{ results: Record<string, string>[]; count: number }> {
  const url = `${CMS_API_BASE}/${datasetId}/0?offset=${offset}&limit=${limit}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          `CMS API returned ${response.status} ${response.statusText}`,
        );
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        console.warn(
          `CMS API request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${lastError.message}`,
        );
      }
    }
  }

  throw lastError;
}

export async function fetchAllPages(
  datasetId: string,
  pageSize = 1000,
): Promise<Record<string, string>[]> {
  const allResults: Record<string, string>[] = [];
  let offset = 0;

  const firstPage = await fetchPage(datasetId, 0, pageSize);
  allResults.push(...firstPage.results);
  const total = firstPage.count;

  console.log(`CMS dataset ${datasetId}: ${total} total records`);

  offset = pageSize;
  while (offset < total) {
    const page = await fetchPage(datasetId, offset, pageSize);
    allResults.push(...page.results);
    offset += pageSize;
  }

  console.log(`Fetched ${allResults.length} records in total`);
  return allResults;
}
