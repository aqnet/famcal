"use client";

import { addDays, monthGrid, startOfDay, startOfWeek, ymd } from "@/lib/calendar-model";
import { age, fmtDateLong, fmtMonthYear } from "@/lib/format";
import type { Weather } from "@/lib/weather-model";
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronIcon, WeatherIcon } from "@/components/icons";
import { slideIn } from "./hooks";

const STALE_MS = 2 * 3600_000;

export function InfoCard({
  now,
  weather,
  weekStart,
  month,
  dots,
  monthOpen,
  onToggleMonth,
  onShiftMonth,
  onPickDate,
  onOpenForecast,
}: {
  now: Date;
  weather: Weather | null;
  weekStart: Date;
  month: Date;
  dots: Map<string, string[]>;
  monthOpen: boolean;
  onToggleMonth: () => void;
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

  // One band marks the shown week and glides to its new row when the week changes; paging to another
  // month slides the grid in from that side instead.
  const gridRef = useRef<HTMLDivElement>(null);
  const [band, setBand] = useState<{ top: number; height: number; glide: boolean } | null>(null);
  const shownMonth = useRef(month.getTime());
  const weekKey = ymd(weekStart);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const paged = shownMonth.current !== month.getTime();
    if (paged) slideIn([grid], month.getTime() > shownMonth.current ? 1 : -1, 40);
    shownMonth.current = month.getTime();
    const measure = (glide: boolean) => {
      const cell = grid.querySelector<HTMLElement>(".month-day.is-week");
      setBand(cell ? { top: cell.offsetTop, height: cell.offsetHeight, glide } : null);
    };
    measure(!paged);
    // Rotation or a shorter screen changes the row height; follow it without gliding.
    // (The observer also fires once on observe; skip that so this change still glides.)
    let first = true;
    const ro = new ResizeObserver(() => (first ? (first = false) : measure(false)));
    ro.observe(grid);
    return () => ro.disconnect();
  }, [month, weekKey]);

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
            <span className="weather-lohi">
              L {Math.round(weather.today.low)}° · H {Math.round(weather.today.high)}°
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

      {/* The month grid can fold away (remembered per device) so the photos get its space; the
          header stays as the way back. */}
      <div className={`month${monthOpen ? "" : " is-folded"}`}>
        <div className="month-head">
          <div className="month-title">{fmtMonthYear(month)}</div>
          {monthOpen && (
            <>
              <button
                className="icon-btn icon-btn-44"
                aria-label="Previous month"
                onClick={() => onShiftMonth(-1)}
              >
                <ChevronIcon dir="left" size={20} />
              </button>
              <button
                className="icon-btn icon-btn-44"
                aria-label="Next month"
                onClick={() => onShiftMonth(1)}
              >
                <ChevronIcon dir="right" size={20} />
              </button>
            </>
          )}
          <button
            className="icon-btn icon-btn-44"
            aria-label={monthOpen ? "Hide month" : "Show month"}
            aria-expanded={monthOpen}
            aria-controls="month-body"
            onClick={onToggleMonth}
          >
            <ChevronIcon dir={monthOpen ? "up" : "down"} size={20} />
          </button>
        </div>
        <div className="month-body" id="month-body" inert={!monthOpen}>
          <div
            ref={gridRef}
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
            {band && (
              <div
                className={`month-band${band.glide ? " is-gliding" : ""}`}
                style={{ transform: `translateY(${band.top}px)`, height: band.height }}
                aria-hidden
              />
            )}
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="month-weekday" aria-hidden>
                {d}
              </div>
            ))}
            {grid.map((d) => {
              const key = ymd(d);
              const inMonth = d.getMonth() === month.getMonth();
              const inWeek = weekKeys.has(key);
              return (
                <button
                  key={key}
                  className={["month-day", inMonth ? "" : "is-out", inWeek ? "is-week" : ""].join(" ")}
                  onClick={(e) => e.timeStamp - swipedAt.current > 400 && onPickDate(startOfDay(d))}
                  aria-label={d.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
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
      </div>
    </section>
  );
}

export function isSameWeek(a: Date, b: Date) {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}
