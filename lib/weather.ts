import "server-only";
import { getCache, getHousehold, setCache } from "@/lib/household";
import { describeCode, summarize, type Weather } from "@/lib/weather-model";

const TTL_SECONDS = 15 * 60;

export type Place = { zip: string; place: string; lat: number; lon: number };

// ZIP → coordinates, once, when the ZIP is saved (FR-41). Zippopotam.us (free, no key) first: it gives
// the ZIP's own centre. Open-Meteo's geocoder is the fallback, but it matches a ZIP to its city and
// returns the city centre (a Seattle ZIP came back as downtown, 7 km off).
export async function geocodeZip(zip: string): Promise<Place | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as {
        places?: {
          "place name": string;
          "state abbreviation": string;
          latitude: string;
          longitude: string;
        }[];
      };
      const p = json.places?.[0];
      if (p) {
        return {
          zip,
          place: `${p["place name"]}, ${p["state abbreviation"]}`,
          lat: Number(p.latitude),
          lon: Number(p.longitude),
        };
      }
    }
  } catch {
    // fall through
  }
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${zip}&count=10&language=en&format=json&countryCode=US`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: {
        name: string;
        admin1?: string;
        latitude: number;
        longitude: number;
        postcodes?: string[];
      }[];
    };
    const hit = json.results?.find((r) => r.postcodes?.includes(zip));
    if (!hit) return null;
    return {
      zip,
      place: [hit.name, stateAbbr(hit.admin1)].filter(Boolean).join(", "),
      lat: hit.latitude,
      lon: hit.longitude,
    };
  } catch {
    return null;
  }
}

const STATES: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  "District of Columbia": "DC",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
};
const stateAbbr = (name?: string) => (name ? (STATES[name] ?? name) : "");

async function fetchForecast(lat: number, lon: number, units: "F" | "C", place: string): Promise<Weather> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code");
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  );
  url.searchParams.set("temperature_unit", units === "F" ? "fahrenheit" : "celsius");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "8");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = (await res.json()) as {
    current: { time: string; temperature_2m: number; weather_code: number; is_day: number };
    hourly: {
      time: string[];
      temperature_2m: number[];
      precipitation_probability: (number | null)[];
      weather_code: number[];
    };
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: (number | null)[];
    };
  };
  const hourly = j.hourly.time.map((time, i) => ({
    time,
    temp: j.hourly.temperature_2m[i],
    precip: j.hourly.precipitation_probability[i] ?? 0,
    code: j.hourly.weather_code[i],
  }));
  const daily = j.daily.time.map((date, i) => ({
    date,
    high: j.daily.temperature_2m_max[i],
    low: j.daily.temperature_2m_min[i],
    precip: j.daily.precipitation_probability_max[i] ?? 0,
    code: j.daily.weather_code[i],
  }));
  const { condition, icon } = describeCode(j.current.weather_code);
  return {
    place,
    units,
    fetchedAt: new Date().toISOString(),
    current: {
      temp: j.current.temperature_2m,
      code: j.current.weather_code,
      condition,
      icon,
      isDay: j.current.is_day === 1,
    },
    today: { high: daily[0]?.high ?? NaN, low: daily[0]?.low ?? NaN, ...summarize(hourly, j.current.time) },
    hourly,
    daily,
  };
}

// Cached for 15 minutes in Postgres; if Open-Meteo is down, the last reading is returned (FR-45).
export async function getWeather(): Promise<Weather | null> {
  const h = await getHousehold();
  if (h.weatherLat === null || h.weatherLon === null) return null;
  const key = `weather:${h.weatherLat.toFixed(3)},${h.weatherLon.toFixed(3)}:${h.units}`;
  const cached = await getCache<Weather>(key);
  if (cached?.fresh) return cached.value;
  try {
    // "City, ST 12345": the ZIP is shown so it's clear which forecast this is.
    const place = [h.weatherPlace, h.weatherZip].filter(Boolean).join(" ");
    const weather = await fetchForecast(h.weatherLat, h.weatherLon, h.units, place);
    await setCache(key, weather, TTL_SECONDS);
    return weather;
  } catch (err) {
    console.error("weather", err);
    return cached?.value ?? null;
  }
}
