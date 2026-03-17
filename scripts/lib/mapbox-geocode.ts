const MAPBOX_GEOCODING_URL =
  "https://api.mapbox.com/geocoding/v5/mapbox.places";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

export interface GeocodingResult {
  lat: number;
  lng: number;
}

function buildAddress(provider: {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string | null {
  const parts = [provider.address, provider.city, provider.state, provider.zip]
    .filter(Boolean)
    .join(", ");
  return parts || null;
}

export async function geocodeAddress(
  provider: {
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  },
  accessToken: string,
): Promise<GeocodingResult | null> {
  const query = buildAddress(provider);
  if (!query) return null;

  const url = `${MAPBOX_GEOCODING_URL}/${encodeURIComponent(query)}.json?access_token=${accessToken}&country=US&limit=1&types=address`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }

      const response = await fetch(url);

      if (response.status === 429) {
        // Rate limited — always retry
        lastError = new Error("Rate limited by Mapbox API");
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `Mapbox API returned ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      const features = data.features;

      if (!features || features.length === 0) return null;

      const [lng, lat] = features[0].center;
      return { lat, lng };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        console.warn(
          `Geocoding failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${lastError.message}`,
        );
      }
    }
  }

  throw lastError;
}

export { buildAddress };
