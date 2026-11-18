// Builds packs/us-cities.json: the largest city in every state (plus a few more major ones),
// with forecast office, time zone and elevation looked up from the National Weather Service.
// Run: node scripts/gen-cities.mjs   (needs network access to api.weather.gov)
import { writeFileSync } from 'node:fs';

// id, name, state, ST, lat, lon, airports (FAA/IATA), FBI field office, zoom
const CITIES = [
  ['huntsville', 'Huntsville', 'Alabama', 'AL', 34.7304, -86.5861, ['HSV'], 'birmingham', 10.2],
  ['birmingham', 'Birmingham', 'Alabama', 'AL', 33.5186, -86.8104, ['BHM'], 'birmingham', 10.2],
  ['anchorage', 'Anchorage', 'Alaska', 'AK', 61.2181, -149.9003, ['ANC', 'MRI'], 'anchorage', 10.2],
  ['phoenix', 'Phoenix', 'Arizona', 'AZ', 33.4484, -112.074, ['PHX', 'DVT', 'SDL'], 'phoenix', 9.7],
  ['little-rock', 'Little Rock', 'Arkansas', 'AR', 34.7465, -92.2896, ['LIT'], 'littlerock', 10.2],
  ['los-angeles', 'Los Angeles', 'California', 'CA', 34.0522, -118.2437, ['LAX', 'BUR', 'VNY'], 'losangeles', 9.5],
  ['san-francisco', 'San Francisco', 'California', 'CA', 37.7749, -122.4194, ['SFO', 'OAK'], 'sanfrancisco', 10.2],
  ['san-diego', 'San Diego', 'California', 'CA', 32.7157, -117.1611, ['SAN', 'MYF'], 'sandiego', 10],
  ['bridgeport', 'Bridgeport', 'Connecticut', 'CT', 41.1865, -73.1952, ['BDR', 'HVN'], 'newhaven', 10.2],
  ['wilmington', 'Wilmington', 'Delaware', 'DE', 39.7391, -75.5398, ['ILG', 'PHL'], 'baltimore', 10.2],
  ['washington', 'Washington', 'District of Columbia', 'DC', 38.9072, -77.0369, ['DCA', 'IAD'], 'washingtondc', 10.2],
  ['jacksonville', 'Jacksonville', 'Florida', 'FL', 30.3322, -81.6557, ['JAX', 'CRG'], 'jacksonville', 9.7],
  ['miami', 'Miami', 'Florida', 'FL', 25.7617, -80.1918, ['MIA', 'FLL', 'OPF'], 'miami', 10],
  ['honolulu', 'Honolulu', 'Hawaii', 'HI', 21.3069, -157.8583, ['HNL'], 'honolulu', 10.2],
  ['boise', 'Boise', 'Idaho', 'ID', 43.615, -116.2023, ['BOI'], 'saltlakecity', 10.2],
  ['chicago', 'Chicago', 'Illinois', 'IL', 41.8781, -87.6298, ['ORD', 'MDW'], 'chicago', 9.7],
  ['indianapolis', 'Indianapolis', 'Indiana', 'IN', 39.7684, -86.1581, ['IND'], 'indianapolis', 10],
  ['des-moines', 'Des Moines', 'Iowa', 'IA', 41.5868, -93.625, ['DSM'], 'omaha', 10.2],
  ['wichita', 'Wichita', 'Kansas', 'KS', 37.6872, -97.3301, ['ICT'], 'kansascity', 10.2],
  ['louisville', 'Louisville', 'Kentucky', 'KY', 38.2527, -85.7585, ['SDF'], 'louisville', 10.2],
  ['new-orleans', 'New Orleans', 'Louisiana', 'LA', 29.9511, -90.0715, ['MSY'], 'neworleans', 10.2],
  ['portland-me', 'Portland', 'Maine', 'ME', 43.6591, -70.2568, ['PWM'], 'boston', 10.5],
  ['baltimore', 'Baltimore', 'Maryland', 'MD', 39.2904, -76.6122, ['BWI'], 'baltimore', 10.2],
  ['boston', 'Boston', 'Massachusetts', 'MA', 42.3601, -71.0589, ['BOS'], 'boston', 10.2],
  ['detroit', 'Detroit', 'Michigan', 'MI', 42.3314, -83.0458, ['DTW', 'DET'], 'detroit', 10],
  ['minneapolis', 'Minneapolis', 'Minnesota', 'MN', 44.9778, -93.265, ['MSP'], 'minneapolis', 10.2],
  ['jackson-ms', 'Jackson', 'Mississippi', 'MS', 32.2988, -90.1848, ['JAN'], 'jackson', 10.2],
  ['kansas-city', 'Kansas City', 'Missouri', 'MO', 39.0997, -94.5786, ['MCI', 'MKC'], 'kansascity', 10],
  ['st-louis', 'St. Louis', 'Missouri', 'MO', 38.627, -90.1994, ['STL'], 'stlouis', 10.2],
  ['billings', 'Billings', 'Montana', 'MT', 45.7833, -108.5007, ['BIL'], 'saltlakecity', 10.5],
  ['omaha', 'Omaha', 'Nebraska', 'NE', 41.2565, -95.9345, ['OMA'], 'omaha', 10.2],
  ['las-vegas', 'Las Vegas', 'Nevada', 'NV', 36.1699, -115.1398, ['LAS', 'VGT', 'HND'], 'lasvegas', 10],
  ['manchester', 'Manchester', 'New Hampshire', 'NH', 42.9956, -71.4548, ['MHT'], 'boston', 10.5],
  ['newark', 'Newark', 'New Jersey', 'NJ', 40.7357, -74.1724, ['EWR'], 'newark', 10.5],
  ['albuquerque', 'Albuquerque', 'New Mexico', 'NM', 35.0844, -106.6504, ['ABQ'], 'albuquerque', 10.2],
  ['new-york', 'New York', 'New York', 'NY', 40.7128, -74.006, ['JFK', 'LGA', 'EWR'], 'newyork', 10],
  ['charlotte', 'Charlotte', 'North Carolina', 'NC', 35.2271, -80.8431, ['CLT'], 'charlotte', 10],
  ['fargo', 'Fargo', 'North Dakota', 'ND', 46.8772, -96.7898, ['FAR'], 'minneapolis', 10.5],
  ['columbus', 'Columbus', 'Ohio', 'OH', 39.9612, -82.9988, ['CMH', 'LCK'], 'cincinnati', 10],
  ['oklahoma-city', 'Oklahoma City', 'Oklahoma', 'OK', 35.4676, -97.5164, ['OKC'], 'oklahomacity', 10],
  ['portland', 'Portland', 'Oregon', 'OR', 45.5152, -122.6784, ['PDX'], 'portland', 10.2],
  ['philadelphia', 'Philadelphia', 'Pennsylvania', 'PA', 39.9526, -75.1652, ['PHL'], 'philadelphia', 10.2],
  ['pittsburgh', 'Pittsburgh', 'Pennsylvania', 'PA', 40.4406, -79.9959, ['PIT'], 'pittsburgh', 10.2],
  ['providence', 'Providence', 'Rhode Island', 'RI', 41.824, -71.4128, ['PVD'], 'boston', 10.5],
  ['charleston-sc', 'Charleston', 'South Carolina', 'SC', 32.7765, -79.9311, ['CHS'], 'columbia', 10.2],
  ['sioux-falls', 'Sioux Falls', 'South Dakota', 'SD', 43.5446, -96.7311, ['FSD'], 'minneapolis', 10.5],
  ['nashville', 'Nashville', 'Tennessee', 'TN', 36.1627, -86.7816, ['BNA'], 'memphis', 10],
  ['memphis', 'Memphis', 'Tennessee', 'TN', 35.1495, -90.049, ['MEM'], 'memphis', 10.2],
  ['houston', 'Houston', 'Texas', 'TX', 29.7604, -95.3698, ['IAH', 'HOU'], 'houston', 9.7],
  ['dallas', 'Dallas', 'Texas', 'TX', 32.7767, -96.797, ['DFW', 'DAL'], 'dallas', 9.9],
  ['austin', 'Austin', 'Texas', 'TX', 30.2672, -97.7431, ['AUS'], 'sanantonio', 10.2],
  ['san-antonio', 'San Antonio', 'Texas', 'TX', 29.4241, -98.4936, ['SAT'], 'sanantonio', 10],
  ['salt-lake-city', 'Salt Lake City', 'Utah', 'UT', 40.7608, -111.891, ['SLC'], 'saltlakecity', 10.2],
  ['burlington', 'Burlington', 'Vermont', 'VT', 44.4759, -73.2121, ['BTV'], 'albany', 10.5],
  ['virginia-beach', 'Virginia Beach', 'Virginia', 'VA', 36.8529, -75.978, ['ORF'], 'norfolk', 10.2],
  ['seattle', 'Seattle', 'Washington', 'WA', 47.6062, -122.3321, ['SEA', 'BFI'], 'seattle', 10.2],
  ['charleston-wv', 'Charleston', 'West Virginia', 'WV', 38.3498, -81.6326, ['CRW'], 'pittsburgh', 10.5],
  ['milwaukee', 'Milwaukee', 'Wisconsin', 'WI', 43.0389, -87.9065, ['MKE'], 'milwaukee', 10.2],
  ['cheyenne', 'Cheyenne', 'Wyoming', 'WY', 41.14, -104.8202, ['CYS'], 'denver', 10.5],
];

const FIPS = { Alabama: 1, Alaska: 2, Arizona: 4, Arkansas: 5, California: 6, Colorado: 8, Connecticut: 9, Delaware: 10, 'District of Columbia': 11, Florida: 12, Georgia: 13, Hawaii: 15, Idaho: 16, Illinois: 17, Indiana: 18, Iowa: 19, Kansas: 20, Kentucky: 21, Louisiana: 22, Maine: 23, Maryland: 24, Massachusetts: 25, Michigan: 26, Minnesota: 27, Mississippi: 28, Missouri: 29, Montana: 30, Nebraska: 31, Nevada: 32, 'New Hampshire': 33, 'New Jersey': 34, 'New Mexico': 35, 'New York': 36, 'North Carolina': 37, 'North Dakota': 38, Ohio: 39, Oklahoma: 40, Oregon: 41, Pennsylvania: 42, 'Rhode Island': 44, 'South Carolina': 45, 'South Dakota': 46, Tennessee: 47, Texas: 48, Utah: 49, Vermont: 50, Virginia: 51, Washington: 53, 'West Virginia': 54, Wisconsin: 55, Wyoming: 56 };

const get = async (url) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Vigilance city-pack generator (github.com/R0N1N9/vigilance)', Accept: 'application/geo+json' } });
    if (r.ok) return r.json();
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  throw new Error(`NWS lookup failed: ${url}`);
};

const out = [];
for (const [id, name, state, st, lat, lon, airports, fbi, zoom] of CITIES) {
  const pt = await get(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const grid = await get(pt.properties.forecastGridData).catch(() => null);
  const elevationFt = Math.round((grid?.properties?.elevation?.value ?? 0) * 3.281);
  const fips = FIPS[state];
  out.push({
    id,
    name,
    region: st,
    timezone: pt.properties.timeZone,
    center: [lon, lat],
    zoom,
    radiusNm: 25,
    fieldElevationFt: elevationFt,
    nwsOffice: pt.properties.gridId,
    radioFeeds: [
      { name: `Scanner feeds · ${state}`, agency: `Live police, fire and EMS audio by county in ${state} (Broadcastify)`, url: `https://www.broadcastify.com/listen/stid/${fips}`, coverage: null },
      { name: `Recorded dispatch · ${name} area`, agency: 'Trunked-radio call recordings (OpenMHz)', url: 'https://openmhz.com/systems', coverage: null },
    ],
    notes: `${name} preset: national sources (aircraft, NWS, fires, quakes, rivers, air quality, outages, FBI) plus local news. Use the Broadcastify state list to pick a ${name} feed.`,
    traffic: { provider: 'none' },
    news: {
      feeds: [],
      googleQuery: `"${name}" ${st} (police OR shooting OR fire OR crash OR arrested OR missing OR stabbing OR SWAT OR evacuation) when:1d`,
      localTerms: [[name, lon, lat]],
    },
    liveTv: [],
    places: [],
    transit: null,
    power: { state, utilities: [] },
    // Cities with a checked open-data crime feed (src/lib/crimeSources.ts).
    intel: { crime: ['chicago', 'new-york', 'san-francisco', 'seattle', 'dallas'].includes(id) ? id : null, s311: null, fbiOffice: fbi, airports },
  });
  process.stdout.write(`${id} ${pt.properties.gridId} ${pt.properties.timeZone} ${elevationFt}ft\n`);
}
writeFileSync(new URL('../packs/us-cities.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${out.length} cities`);
