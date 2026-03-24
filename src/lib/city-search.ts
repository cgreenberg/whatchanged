export type CityResult = {
  display: string;
  zip: string;
  source: "static" | "census" | "local";
};

// 2-letter abbreviations
const STATE_ABBREVS = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in",
  "ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv",
  "nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn",
  "tx","ut","vt","va","wa","wv","wi","wy","dc",
]);

// Full state names → abbreviations
const STATE_NAMES: Record<string, string> = {
  "alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar",
  "california": "ca", "colorado": "co", "connecticut": "ct", "delaware": "de",
  "florida": "fl", "georgia": "ga", "hawaii": "hi", "idaho": "id",
  "illinois": "il", "indiana": "in", "iowa": "ia", "kansas": "ks",
  "kentucky": "ky", "louisiana": "la", "maine": "me", "maryland": "md",
  "massachusetts": "ma", "michigan": "mi", "minnesota": "mn", "mississippi": "ms",
  "missouri": "mo", "montana": "mt", "nebraska": "ne", "nevada": "nv",
  "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
  "north carolina": "nc", "north dakota": "nd", "ohio": "oh", "oklahoma": "ok",
  "oregon": "or", "pennsylvania": "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", "tennessee": "tn", "texas": "tx", "utah": "ut",
  "vermont": "vt", "virginia": "va", "washington": "wa", "west virginia": "wv",
  "wisconsin": "wi", "wyoming": "wy", "district of columbia": "dc",
};

export function parseQuery(query: string): { city: string; state?: string } {
  const q = query.trim().toLowerCase().replace(/,/g, "");
  const words = q.split(/\s+/);
  const lastWord = words[words.length - 1];

  // Check 2-letter abbreviation
  if (words.length > 1 && STATE_ABBREVS.has(lastWord)) {
    return { city: words.slice(0, -1).join(" "), state: lastWord };
  }

  // Check full state name (last 1 or 2 words)
  if (words.length > 1) {
    const lastTwo = words.slice(-2).join(" ");
    if (STATE_NAMES[lastTwo]) {
      return { city: words.slice(0, -2).join(" "), state: STATE_NAMES[lastTwo] };
    }
    if (STATE_NAMES[lastWord]) {
      return { city: words.slice(0, -1).join(" "), state: STATE_NAMES[lastWord] };
    }
  }

  return { city: q };
}

export async function geocodeCityToZip(
  city: string,
  state?: string
): Promise<CityResult | null> {
  try {
    const query = state ? `${city} ${state}` : city;
    const url = `/api/city-search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;

    const data: CityResult[] = await res.json();
    if (data.length === 0) return null;

    return data[0];
  } catch {
    return null;
  }
}
