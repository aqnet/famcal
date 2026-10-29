import { describe, expect, it } from "vitest";
import { describeCode, eventForecast, isNight, localIso, summarize, type Weather } from "./weather-model";

const hours = (spec: [string, number, number][]) =>
  spec.map(([time, precip, code]) => ({ time, temp: 50, precip, code }));

describe("summarize", () => {
  it("says when rain tapers off", () => {
    const h = hours([
      ["2026-10-27T10:00", 80, 61],
      ["2026-10-27T11:00", 60, 61],
      ["2026-10-27T14:00", 10, 3],
    ]);
    expect(summarize(h, "2026-10-27T10:42")).toEqual({ summary: "Tapering by 2 PM", rainy: true });
  });

  it("warns of rain later and reports dry days", () => {
    expect(
      summarize(
        hours([
          ["2026-10-27T10:00", 0, 1],
          ["2026-10-27T15:00", 55, 3],
        ]),
        "2026-10-27T10:00",
      ).summary,
    ).toBe("Rain likely from 3 PM");
    expect(summarize(hours([["2026-10-27T10:00", 0, 0]]), "2026-10-27T10:00").summary).toBe(
      "Dry the rest of today",
    );
  });
});

describe("eventForecast", () => {
  const weather = { hourly: [{ time: "2026-10-31T09:00", temp: 52.4, precip: 60, code: 61 }] } as Weather;

  it("tags an event from the forecast at its start hour", () => {
    expect(eventForecast(weather, new Date(2026, 9, 31, 9, 30))?.text).toBe("Rain 60% · 52°");
  });

  it("returns nothing outside the forecast range", () => {
    expect(eventForecast(weather, new Date(2026, 10, 20, 9))).toBeNull();
  });
});

describe("day and night", () => {
  const w = {
    daily: [
      { date: "2026-10-28", sunrise: "2026-10-28T07:44", sunset: "2026-10-28T17:59" },
      { date: "2026-10-29", high: 55, low: 45, precip: 0, code: 0 }, // cached before sunrise was read
    ],
  } as Weather;

  it("is night before sunrise and from sunset on", () => {
    expect(isNight(w, "2026-10-28T07:43")).toBe(true);
    expect(isNight(w, "2026-10-28T07:44")).toBe(false);
    expect(isNight(w, "2026-10-28T17:58")).toBe(false);
    expect(isNight(w, "2026-10-28T17:59")).toBe(true);
  });

  it("counts a day without sun times as daytime", () => {
    expect(isNight(w, "2026-10-29T23:00")).toBe(false);
    expect(isNight(w, "2026-11-05T23:00")).toBe(false);
  });

  it("shows the moon for clear and partly cloudy nights only", () => {
    expect(describeCode(0, true).icon).toBe("moon");
    expect(describeCode(2, true)).toEqual({ condition: "Partly cloudy", icon: "partly-night" });
    expect(describeCode(0).icon).toBe("sun");
    expect(describeCode(61, true).icon).toBe("rain");
  });

  it("formats a device time as the forecast's local ISO", () => {
    expect(localIso(new Date(2026, 9, 28, 7, 5))).toBe("2026-10-28T07:05");
  });
});
