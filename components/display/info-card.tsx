"use client";

import { addDays, monthGrid, startOfDay, startOfWeek, ymd } from "@/lib/calendar-model";
import { age, fmtDateLong, fmtMonthYear } from "@/lib/format";
import type { Weather } from "@/lib/weather-model";
import { useRef } from "react";
import { ChevronIcon, WeatherIcon } from "@/components/icons";

const STALE_MS = 2 * 3600_000;

export function InfoCard({
  now,
  weather,
  weekStart,
  month,
  dots,
  onShiftMonth,
  onPickDate,
  onOpenForecast,
}: {
  now: Date;
  weather: Weather | null;
  weekStart: Date;
  month: Date;
  dots: Map<string, string[]>;
  onShiftMonth: (dir: 1 | -1) => void;
  onPickDate: (d: Date) => void;
  onOpenForecast: () => void;
}) {
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const [clock, ampm] = time.split(" ");
  const stale = weather ? now.getTime() - Date.parse(weather.fetchedAt) > STALE_MS : false;
  const grid = monthGrid(month);
  const today = ymd(now);
  const weekKeys = new Set(Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i))));

  // Swipe the month grid to page months; the tap that ends a swipe must not also pick a day.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipedAt = useRef(0);

  return (
    <section className="info-card" aria-label="Today">
      <div className="info-row">
        <div>
          <div className="clock">
            {clock}
            <span className="clock-ampm">{ampm}</span>
          </div>
          <div className="info-date">{fmtDateLong(now)}</div>
        </div>
        {weather && (
          <button
            className={`weather-block${stale ? " is-stale" : ""}`}
            onClick={onOpenForecast}
            aria-label={`Weather: ${weather.current.condition}, ${Math.round(weather.current.temp)} degrees. Open forecast`}
          >
            <span className="weather-now">
              <WeatherIcon kind={weather.current.icon} size={40} />
              <span className="weather-temp">
                {Math.round(weather.current.temp)}°
                {stale && <span className="weather-age"> · {age(weather.fetchedAt, now)}</span>}
              </span>
            </span>
            <span className="weather-cond">{weather.current.condition}</span>
            {weather.place && <span className="weather-place">{weather.place}</span>}
            {weather.today.summary && (
              <span className={`weather-summary${weather.today.rainy ? " is-rain" : ""}`}>
                {weather.today.summary}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="month">
        <div className="month-head">
          <div className="month-title">{fmtMonthYear(month)}</div>
          <button
            className="icon-btn icon-btn-44"
            aria-label="Previous month"
            onClick={() => onShiftMonth(-1)}
          >
            <ChevronIcon dir="left" size={20} />
          </button>
          <button className="icon-btn icon-btn-44" aria-label="Next month" onClick={() => onShiftMonth(1)}>
            <ChevronIcon dir="right" size={20} />
          </button>
        </div>
        <div
          className="month-grid"
          role="grid"
          onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
          onPointerCancel={() => (swipe.current = null)}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s) return;
            const dx = e.clientX - s.x;
            if (Math.abs(dx) >= 40 && Math.abs(e.clientY - s.y) < Math.abs(dx)) {
              swipedAt.current = e.timeStamp;
              onShiftMonth(dx < 0 ? 1 : -1);
            }
          }}
        >
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="month-weekday" aria-hidden>
              {d}
            </div>
          ))}
          {grid.map((d) => {
            const key = ymd(d);
            const inMonth = d.getMonth() === month.getMonth();
            const inWeek = weekKeys.has(key);
            const col = d.getDay();
            return (
              <button
                key={key}
                className={[
                  "month-day",
                  inMonth ? "" : "is-out",
                  inWeek ? "is-week" : "",
                  inWeek && col === 0 ? "is-week-start" : "",
                  inWeek && col === 6 ? "is-week-end" : "",
                ].join(" ")}
                onClick={(e) => e.timeStamp - swipedAt.current > 400 && onPickDate(startOfDay(d))}
                aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              >
                <span className={`month-num${key === today ? " is-today" : ""}`}>{d.getDate()}</span>
                <span className="month-dots">
                  {(dots.get(key) ?? []).slice(0, 3).map((c, i) => (
                    <span key={i} className="dot" style={{ background: c }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function isSameWeek(a: Date, b: Date) {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}
