// Weather shapes and text, shared by server and display.

export type IconKind =
  "sun" | "moon" | "partly" | "partly-night" | "cloud" | "fog" | "rain" | "snow" | "storm";

export type Weather = {
  place: string;
  units: "F" | "C";
  fetchedAt: string;
  current: { temp: number; code: number; condition: string; icon: IconKind; isDay: boolean };
  today: { high: number; low: number; summary: string; rainy: boolean };
  hourly: { time: string; temp: number; precip: number; code: number }[]; // local ISO without offset
  daily: {
    date: string;
    high: number;
    low: number;
    precip: number;
    code: number;
    sunrise?: string; // local ISO without offset; absent in readings cached before it was fetched
    sunset?: string;
  }[];
};

// WMO weather codes used by Open-Meteo. At night a clear sky shows the moon instead of the sun.
export function describeCode(code: number, night = false): { condition: string; icon: IconKind } {
  if (code === 0) return { condition: "Clear", icon: night ? "moon" : "sun" };
  if (code === 1 || code === 2)
    return {
      condition: code === 1 ? "Mostly clear" : "Partly cloudy",
      icon: night ? "partly-night" : "partly",
    };
  if (code === 3) return { condition: "Cloudy", icon: "cloud" };
  if (code === 45 || code === 48) return { condition: "Fog", icon: "fog" };
  if (code >= 51 && code <= 57) return { condition: "Drizzle", icon: "rain" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82))
    return { condition: code >= 80 ? "Showers" : "Rain", icon: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { condition: "Snow", icon: "snow" };
  if (code >= 95) return { condition: "Thunderstorms", icon: "storm" };
  return { condition: "—", icon: "cloud" };
}

// Local "YYYY-MM-DDTHH:MM" for a device time; the display runs in the forecast's zone.
export function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Whether a local time falls between that day's sunrise and sunset. Unknown days count as day.
export function isNight(weather: Weather, at: string): boolean {
  const day = weather.daily.find((d) => d.date === at.slice(0, 10));
  if (!day?.sunrise || !day.sunset) return false;
  return at < day.sunrise || at >= day.sunset;
}

export const isWet = (code: number) => ["rain", "snow", "storm"].includes(describeCode(code).icon);

function hourLabel(localIso: string): string {
  const h = Number(localIso.slice(11, 13));
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}

// One-line summary for the rest of today, e.g. "Tapering by 2 PM" or "Rain likely from 3 PM".
export function summarize(
  hourly: Weather["hourly"],
  nowLocalIso: string,
): { summary: string; rainy: boolean } {
  const today = nowLocalIso.slice(0, 10);
  const rest = hourly.filter(
    (h) => h.time.slice(0, 10) === today && h.time.slice(0, 13) >= nowLocalIso.slice(0, 13),
  );
  if (!rest.length) return { summary: "", rainy: false };
  const wet = (h: Weather["hourly"][number]) => h.precip >= 40 || isWet(h.code);
  if (wet(rest[0])) {
    const stop = rest.find((h) => !wet(h));
    return { summary: stop ? `Tapering by ${hourLabel(stop.time)}` : "Wet all day", rainy: true };
  }
  const start = rest.find(wet);
  if (start) return { summary: `Rain likely from ${hourLabel(start.time)}`, rainy: true };
  return { summary: "Dry the rest of today", rainy: false };
}

// Forecast tag for an outdoor event (FR-44): "Rain 60% · 52°" or "Dry · 54°"; null beyond 7 days.
export function eventForecast(
  weather: Weather | null,
  start: Date,
): { text: string; rain: boolean; detail: string } | null {
  if (!weather) return null;
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}T${String(start.getHours()).padStart(2, "0")}`;
  const hour = weather.hourly.find((h) => h.time.slice(0, 13) === key);
  if (!hour) return null;
  const temp = `${Math.round(hour.temp)}°`;
  const rain = hour.precip >= 40;
  const { condition } = describeCode(hour.code);
  return {
    text: rain ? `Rain ${hour.precip}% · ${temp}` : `Dry · ${temp}`,
    rain,
    detail: `${condition}, ${temp}, ${hour.precip}% chance of rain`,
  };
}
