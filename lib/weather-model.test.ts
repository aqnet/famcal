import { describe, expect, it } from "vitest";
import { eventForecast, summarize, type Weather } from "./weather-model";

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
