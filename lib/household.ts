import "server-only";
import { db } from "@/lib/db";

export type FamilyMember = { name: string; email: string };

export type PhotoSource = {
  url: string;
  nodeId: string;
  name: string;
  type: "Album" | "Folder";
  directOnly: boolean;
  keyword?: string;
  newest?: number;
  galleryCount: number;
  photoCount: number;
};

export type Household = {
  weatherZip: string | null;
  weatherPlace: string | null;
  weatherLat: number | null;
  weatherLon: number | null;
  units: "F" | "C";
  outdoorKeywords: string[];
  rotationSeconds: number;
  nightStart: string; // "HH:MM"
  nightEnd: string;
  familyMembers: FamilyMember[];
  photoSources: PhotoSource[];
  hasPin: boolean;
};

type Row = {
  weather_zip: string | null;
  weather_place: string | null;
  weather_lat: number | null;
  weather_lon: number | null;
  units: "F" | "C";
  outdoor_keywords: string[];
  rotation_seconds: number;
  night_start: string;
  night_end: string;
  family_members: FamilyMember[];
  photo_sources: PhotoSource[];
  pin_hash: string | null;
};

export async function getHousehold(): Promise<Household> {
  const [row] = await db()<Row[]>`
    select weather_zip, weather_place, weather_lat, weather_lon, units, outdoor_keywords, rotation_seconds,
           to_char(night_start, 'HH24:MI') as night_start, to_char(night_end, 'HH24:MI') as night_end,
           family_members, photo_sources, pin_hash
    from famcal.household where id = 1`;
  return {
    weatherZip: row.weather_zip,
    weatherPlace: row.weather_place,
    weatherLat: row.weather_lat,
    weatherLon: row.weather_lon,
    units: row.units,
    outdoorKeywords: row.outdoor_keywords,
    rotationSeconds: row.rotation_seconds,
    nightStart: row.night_start,
    nightEnd: row.night_end,
    familyMembers: row.family_members,
    photoSources: row.photo_sources,
    hasPin: row.pin_hash !== null,
  };
}

export async function getCache<T>(key: string): Promise<{ value: T; fresh: boolean } | null> {
  const [row] = await db()<{ value: T; fresh: boolean }[]>`
    select value, expires_at > now() as fresh from famcal.cache where key = ${key}`;
  return row ?? null;
}

export async function setCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await db()`
    insert into famcal.cache (key, value, expires_at)
    values (${key}, ${db().json(value as never)}, now() + make_interval(secs => ${ttlSeconds}))
    on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`;
}
