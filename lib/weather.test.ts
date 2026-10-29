import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/household", () => ({
  getHousehold: vi.fn(),
  getCache: vi.fn(async () => null),
  setCache: vi.fn(async () => undefined),
}));
const household = await import("./household");
const { geocodeZip, getWeather } = await import("./weather");

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("geocodeZip (FR-41)", () => {
  it("only looks up 5-digit ZIPs", async () => {
    for (const zip of ["9810", "98103-1234", "abcde", ""]) expect(await geocodeZip(zip)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the ZIP's own centre from Zippopotam.us", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        places: [
          {
            "place name": "Seattle",
            "state abbreviation": "WA",
            latitude: "47.6619",
            longitude: "-122.3419",
          },
        ],
      }),
    );
    expect(await geocodeZip("98103")).toEqual({
      zip: "98103",
      place: "Seattle, WA",
      lat: 47.6619,
      lon: -122.3419,
    });
  });

  it("falls back to Open-Meteo, accepting only a result that lists the ZIP", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 })).mockResolvedValueOnce(
      json({
        results: [
          { name: "Elsewhere", admin1: "Oregon", latitude: 1, longitude: 2, postcodes: ["97000"] },
          { name: "Seattle", admin1: "Washington", latitude: 47.6, longitude: -122.3, postcodes: ["98103"] },
        ],
      }),
    );
    expect(await geocodeZip("98103")).toEqual({ zip: "98103", place: "Seattle, WA", lat: 47.6, lon: -122.3 });
  });

  it("returns nothing when neither service knows it or both are down", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(json({ results: [] }));
    expect(await geocodeZip("00000")).toBeNull();
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await geocodeZip("98103")).toBeNull();
  });
});

describe("getWeather (FR-42, FR-45)", () => {
  const home = {
    weatherLat: 47.6619,
    weatherLon: -122.3419,
    weatherPlace: "Seattle, WA",
    weatherZip: "98103",
    units: "F",
  };
  const forecast = {
    current: { time: "2026-10-28T15:00", temperature_2m: 51.4, weather_code: 3, is_day: 1 },
    hourly: {
      time: ["2026-10-28T15:00", "2026-10-28T16:00"],
      temperature_2m: [51, 50],
      precipitation_probability: [10, null],
      weather_code: [3, 61],
    },
    daily: {
      time: ["2026-10-28", "2026-10-29"],
      weather_code: [3, 61],
      temperature_2m_max: [52, 55],
      temperature_2m_min: [43, 45],
      precipitation_probability_max: [20, null],
      sunrise: ["2026-10-28T07:44", "2026-10-29T07:46"],
      sunset: ["2026-10-28T17:59", "2026-10-29T17:57"],
    },
  };

  it("has nothing to show until a ZIP is set", async () => {
    vi.mocked(household.getHousehold).mockResolvedValue({ ...home, weatherLat: null } as never);
    expect(await getWeather()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks Open-Meteo in the household's units and maps the reading", async () => {
    vi.mocked(household.getHousehold).mockResolvedValue({ ...home, units: "C" } as never);
    fetchMock.mockResolvedValueOnce(json(forecast));
    const w = (await getWeather())!;
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("temperature_unit")).toBe("celsius");
    expect(url.searchParams.get("latitude")).toBe("47.6619");
    expect(w).toMatchObject({
      place: "Seattle, WA 98103",
      units: "C",
      current: { temp: 51.4, code: 3, isDay: true },
      today: { high: 52, low: 43 },
    });
    expect(url.searchParams.get("daily")).toContain("sunrise,sunset");
    expect(w.daily[0]).toMatchObject({ sunrise: "2026-10-28T07:44", sunset: "2026-10-28T17:59" });
    expect(w.hourly[1].precip).toBe(0); // a missing chance of rain counts as none
    expect(household.setCache).toHaveBeenCalledWith("weather:47.662,-122.342:C", w, 900);
  });

  it("serves a fresh cached reading without calling Open-Meteo", async () => {
    vi.mocked(household.getHousehold).mockResolvedValue(home as never);
    vi.mocked(household.getCache).mockResolvedValueOnce({ value: { cached: true }, fresh: true });
    expect(await getWeather()).toEqual({ cached: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the last reading when Open-Meteo is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(household.getHousehold).mockResolvedValue(home as never);
    vi.mocked(household.getCache).mockResolvedValueOnce({ value: { stale: true }, fresh: false });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    expect(await getWeather()).toEqual({ stale: true });
  });
});
