import * as https from "https";
import * as fs from "fs";
import * as path from "path";

const API_BASE =
  "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-united-states-of-america-zc-point/records";
const JSON_PATH = path.resolve(
  __dirname,
  "../src/lib/data/zip-county.json"
);

const STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC","PR","VI","GU","MP","AS",
];

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (!location) return reject(new Error("Redirect with no location"));
          resolve(fetchJson(location));
          return;
        }
        if (res.statusCode !== 200) {
          // Capture error body for debugging
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            reject(
              new Error(
                `HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8").slice(0, 200)}`
              )
            )
          );
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (e) {
            reject(e);
          }
        });
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function fetchStateZips(
  state: string,
  map: Map<string, string>
): Promise<void> {
  const pageSize = 100;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const url = `${API_BASE}?limit=${pageSize}&offset=${offset}&select=zip_code,usps_city&where=stusps_code%3D'${state}'`;
    const data = (await fetchJson(url)) as {
      total_count: number;
      results: Array<{ zip_code: string; usps_city: string }>;
    };

    if (total === Infinity) {
      total = data.total_count;
    }

    for (const record of data.results) {
      const zip = record.zip_code?.trim().padStart(5, "0");
      const city = record.usps_city?.trim();
      if (zip && city && !map.has(zip)) {
        map.set(zip, city);
      }
    }

    offset += data.results.length;

    if (data.results.length === 0) break; // safety: avoid infinite loop

    // small pause to be polite to the API
    await new Promise((r) => setTimeout(r, 30));
  }
}

async function fetchAllZips(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (let i = 0; i < STATE_CODES.length; i++) {
    const state = STATE_CODES[i];
    await fetchStateZips(state, map);
    process.stdout.write(
      `\r[${i + 1}/${STATE_CODES.length}] ${state} — ${map.size.toLocaleString()} zips loaded...`
    );
  }

  process.stdout.write("\n");
  return map;
}

async function main() {
  console.log("Fetching zip-to-city data from opendatasoft (by state)...");
  const cityMap = await fetchAllZips();
  console.log(`Loaded ${cityMap.size.toLocaleString()} zip→city mappings`);

  console.log("Reading zip-county.json...");
  const raw = fs.readFileSync(JSON_PATH, "utf8");
  const data = JSON.parse(raw) as Record<
    string,
    {
      countyFips: string;
      countyName: string;
      stateName: string;
      stateAbbr: string;
      cityName: string;
    }
  >;

  let matched = 0;
  let unmatched = 0;

  for (const [zip, entry] of Object.entries(data)) {
    const city = cityMap.get(zip);
    if (city) {
      entry.cityName = city;
      matched++;
    } else {
      entry.cityName = "";
      unmatched++;
    }
  }

  console.log(
    `Matched: ${matched.toLocaleString()}, Unmatched: ${unmatched.toLocaleString()}`
  );

  console.log("Writing updated JSON...");
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2), "utf8");
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
