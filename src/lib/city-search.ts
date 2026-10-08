export type CityResult = {
  display: string;
  zip: string;
  source: "static" | "census" | "local";
};

// 2-letter abbreviations (50 states, DC, and the territories in zip-county.json)
export const STATE_ABBREVS = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in",
  "ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv",
  "nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn",
  "tx","ut","vt","va","wa","wv","wi","wy","dc",
  "pr","vi","gu","mp","as",
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
  "puerto rico": "pr", "virgin islands": "vi", "guam": "gu",
  "northern mariana islands": "mp", "american samoa": "as",
};

/** Merge result lists in order, dropping later duplicates (same zip or same display). */
export function mergeCityResults(...lists: CityResult[][]): CityResult[] {
  const seen = new Set<string>();
  const out: CityResult[] = [];
  for (const list of lists) {
    for (const r of list) {
      const key = r.display.toLowerCase();
      if (seen.has(key) || seen.has(r.zip)) continue;
      seen.add(key);
      seen.add(r.zip);
      out.push(r);
    }
  }
  return out;
}

export function parseQuery(query: string): { city: string; state?: string } {
  const q = query.trim().toLowerCase().replace(/,/g, "");
  const words = q.split(/\s+/);
  const lastWord = words[words.length - 1];

  // Check 2-letter abbreviation
  if (words.length > 1 && STATE_ABBREVS.has(lastWord)) {
    return { city: words.slice(0, -1).join(" "), state: lastWord };
  }

  // Check full state name (last 1, 2 or 3 words)
  if (words.length > 1) {
    const lastThree = words.slice(-3).join(" ");
    if (words.length > 3 && STATE_NAMES[lastThree]) {
      return { city: words.slice(0, -3).join(" "), state: STATE_NAMES[lastThree] };
    }
    const lastTwo = words.slice(-2).join(" ");
    if (words.length > 2 && STATE_NAMES[lastTwo]) {
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
