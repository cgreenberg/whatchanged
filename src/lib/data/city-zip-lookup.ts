export const CITY_ZIP_LOOKUP: {
  city: string; state: string; zip: string; display: string
}[] = [
  { city: "new york",          state: "ny", zip: "10001", display: "New York, NY" },
  { city: "los angeles",       state: "ca", zip: "90001", display: "Los Angeles, CA" },
  { city: "chicago",           state: "il", zip: "60601", display: "Chicago, IL" },
  { city: "houston",           state: "tx", zip: "77002", display: "Houston, TX" },
  { city: "phoenix",           state: "az", zip: "85004", display: "Phoenix, AZ" },
  { city: "philadelphia",      state: "pa", zip: "19103", display: "Philadelphia, PA" },
  { city: "san antonio",       state: "tx", zip: "78201", display: "San Antonio, TX" },
  { city: "san diego",         state: "ca", zip: "92101", display: "San Diego, CA" },
  { city: "dallas",            state: "tx", zip: "75201", display: "Dallas, TX" },
  { city: "san jose",          state: "ca", zip: "95101", display: "San Jose, CA" },
  { city: "austin",            state: "tx", zip: "78701", display: "Austin, TX" },
  { city: "jacksonville",      state: "fl", zip: "32202", display: "Jacksonville, FL" },
  { city: "fort worth",        state: "tx", zip: "76102", display: "Fort Worth, TX" },
  { city: "columbus",          state: "oh", zip: "43215", display: "Columbus, OH" },
  { city: "charlotte",         state: "nc", zip: "28202", display: "Charlotte, NC" },
  { city: "indianapolis",      state: "in", zip: "46204", display: "Indianapolis, IN" },
  { city: "san francisco",     state: "ca", zip: "94102", display: "San Francisco, CA" },
  { city: "seattle",           state: "wa", zip: "98101", display: "Seattle, WA" },
  { city: "denver",            state: "co", zip: "80203", display: "Denver, CO" },
  { city: "nashville",         state: "tn", zip: "37201", display: "Nashville, TN" },
  { city: "oklahoma city",     state: "ok", zip: "73102", display: "Oklahoma City, OK" },
  { city: "el paso",           state: "tx", zip: "79901", display: "El Paso, TX" },
  { city: "washington",        state: "dc", zip: "20001", display: "Washington, DC" },
  { city: "las vegas",         state: "nv", zip: "89101", display: "Las Vegas, NV" },
  { city: "louisville",        state: "ky", zip: "40202", display: "Louisville, KY" },
  { city: "memphis",           state: "tn", zip: "38103", display: "Memphis, TN" },
  { city: "portland",          state: "or", zip: "97201", display: "Portland, OR" },
  { city: "baltimore",         state: "md", zip: "21201", display: "Baltimore, MD" },
  { city: "milwaukee",         state: "wi", zip: "53202", display: "Milwaukee, WI" },
  { city: "albuquerque",       state: "nm", zip: "87102", display: "Albuquerque, NM" },
  { city: "tucson",            state: "az", zip: "85701", display: "Tucson, AZ" },
  { city: "fresno",            state: "ca", zip: "93701", display: "Fresno, CA" },
  { city: "sacramento",        state: "ca", zip: "95814", display: "Sacramento, CA" },
  { city: "mesa",              state: "az", zip: "85201", display: "Mesa, AZ" },
  { city: "kansas city",       state: "mo", zip: "64106", display: "Kansas City, MO" },
  { city: "atlanta",           state: "ga", zip: "30303", display: "Atlanta, GA" },
  { city: "omaha",             state: "ne", zip: "68102", display: "Omaha, NE" },
  { city: "colorado springs",  state: "co", zip: "80903", display: "Colorado Springs, CO" },
  { city: "raleigh",           state: "nc", zip: "27601", display: "Raleigh, NC" },
  { city: "long beach",        state: "ca", zip: "90801", display: "Long Beach, CA" },
  { city: "virginia beach",    state: "va", zip: "23450", display: "Virginia Beach, VA" },
  { city: "minneapolis",       state: "mn", zip: "55401", display: "Minneapolis, MN" },
  { city: "tampa",             state: "fl", zip: "33602", display: "Tampa, FL" },
  { city: "new orleans",       state: "la", zip: "70112", display: "New Orleans, LA" },
  { city: "detroit",           state: "mi", zip: "48201", display: "Detroit, MI" },
  { city: "miami",             state: "fl", zip: "33130", display: "Miami, FL" },
  { city: "boston",             state: "ma", zip: "02108", display: "Boston, MA" },
  { city: "pittsburgh",        state: "pa", zip: "15201", display: "Pittsburgh, PA" },
  { city: "cleveland",         state: "oh", zip: "44113", display: "Cleveland, OH" },
  { city: "st. louis",         state: "mo", zip: "63101", display: "St. Louis, MO" },
];

export function searchCitiesStatic(query: string): typeof CITY_ZIP_LOOKUP {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  return CITY_ZIP_LOOKUP
    .filter(c =>
      c.city.startsWith(q) ||
      c.display.toLowerCase().startsWith(q) ||
      `${c.city}, ${c.state}`.startsWith(q)
    )
    .slice(0, 6);
}
