"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { describeCode, isNight, type Weather } from "@/lib/weather-model";
import { WeatherIcon } from "@/components/icons";
import { reducedMotion } from "./hooks";
import type { Photo } from "./types";

// `restart` resets the timer whenever it changes.
function useAutoClose(onClose: () => void, ms = 30_000, restart?: unknown) {
  useEffect(() => {
    const t = setTimeout(onClose, ms);
    return () => clearTimeout(t);
  }, [onClose, ms, restart]);
}

// Hourly (next 12 h) and 5-day forecast, anchored to the info card (FR-43, FR-46).
export function ForecastSheet({
  weather,
  now,
  onClose,
}: {
  weather: Weather;
  now: Date;
  onClose: () => void;
}) {
  useAutoClose(onClose);
  const hourKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}`;
  const from = Math.max(
    0,
    weather.hourly.findIndex((h) => h.time.slice(0, 13) === hourKey),
  );
  const hours = weather.hourly.slice(from, from + 12);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="forecast-sheet" role="dialog" aria-label="Forecast">
        <h2 className="sheet-title">{weather.place || "Forecast"}</h2>
        <div className="hourly">
          {hours.map((h) => {
            const hr = Number(h.time.slice(11, 13));
            return (
              <div key={h.time} className="hour">
                <span className="hour-time">{`${hr % 12 || 12}${hr < 12 ? "a" : "p"}`}</span>
                <WeatherIcon kind={describeCode(h.code, isNight(weather, h.time)).icon} size={28} />
                <span className="hour-temp">{Math.round(h.temp)}°</span>
                <span className={`hour-precip${h.precip >= 40 ? " is-rain" : ""}`}>{h.precip}%</span>
              </div>
            );
          })}
        </div>
        <div className="daily">
          {weather.daily.slice(0, 5).map((d) => (
            <div key={d.date} className="daily-row">
              <span className="daily-day">
                {new Date(`${d.date}T12:00`).toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <WeatherIcon kind={describeCode(d.code).icon} size={28} />
              <span className={`daily-precip${d.precip >= 40 ? " is-rain" : ""}`}>{d.precip}%</span>
              <span className="daily-hilo">
                {Math.round(d.high)}° / {Math.round(d.low)}°
              </span>
            </div>
          ))}
        </div>
        <p className="attribution">
          Weather data by <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0)
        </p>
      </section>
    </>
  );
}

const GAP = 24; // black space between photos while swiping

// Full-screen photo (FR-40). Swipe or use the arrow keys to move through the set (it wraps around);
// the photo follows the finger and its neighbours wait on either side. A tap closes it.
export function PhotoViewer({
  photos,
  startKey,
  onClose,
}: {
  photos: Photo[];
  startKey: string;
  onClose: () => void;
}) {
  const [key, setKey] = useState(startKey);
  const n = photos.length;
  const at = Math.max(
    0,
    photos.findIndex((p) => p.key === key),
  );
  const photo = photos[at];
  useAutoClose(onClose, 30_000, key); // each photo gets its own 30 s

  // Fetch two further photos each way, so stepping quickly doesn't land on a blank screen.
  useEffect(() => {
    if (n < 4) return;
    for (const d of [-2, 2]) new Image().src = photos[(at + d + n) % n].fullUrl;
  }, [at, n, photos]);

  const track = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const go = useCallback(
    (dir: 1 | -1) => {
      const el = track.current;
      if (!el || n < 2 || busy.current) return;
      const next = photos[(at + dir + n) % n].key;
      // Swap the photos in and put the strip back in the same frame. Resetting first, with React's
      // render still to come, showed the photo just left for a frame (the flash when swiping).
      const done = (a?: Animation) => {
        flushSync(() => setKey(next));
        el.style.transform = "";
        a?.cancel();
        busy.current = false;
      };
      if (reducedMotion()) return done();
      busy.current = true;
      const from = getComputedStyle(el).transform;
      el.animate(
        [
          { transform: from === "none" ? "translateX(0)" : from },
          { transform: `translateX(calc(${-dir * 100}% - ${dir * GAP}px))` },
        ],
        {
          duration: 260,
          easing: "cubic-bezier(.2,.7,.3,1)",
          fill: "forwards",
        },
      ).finished.then(done, () => done());
    },
    [at, n, photos],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // Drag: follow the finger; let go past a quarter of the width (or with a flick) to move on.
  const drag = useRef<{ x: number; y: number; t: number; dx: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (busy.current) return;
    drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, dx: 0, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !track.current) return;
    d.dx = e.clientX - d.x;
    if (Math.abs(d.dx) > 8 || Math.abs(e.clientY - d.y) > 8) d.moved = true;
    if (n > 1) track.current.style.transform = `translateX(${d.dx}px)`;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const el = track.current;
    if (!d || !el) return;
    if (!d.moved) return onClose();
    const speed = Math.abs(d.dx) / Math.max(1, e.timeStamp - d.t); // px per ms
    if (n > 1 && (Math.abs(d.dx) > el.clientWidth / 4 || (speed > 0.5 && Math.abs(d.dx) > 30))) {
      return go(d.dx < 0 ? 1 : -1);
    }
    if (reducedMotion()) {
      el.style.transform = "";
      return;
    }
    el.animate([{ transform: el.style.transform || "none" }, { transform: "translateX(0)" }], {
      duration: 200,
      easing: "ease-out",
    });
    el.style.transform = "";
  };

  if (!photo) return null;
  // The current photo and its neighbours; with two photos the same one waits on both sides.
  const slides =
    n < 2
      ? [{ p: photo, pos: 0 }]
      : [
          { p: photos[(at - 1 + n) % n], pos: -1 },
          { p: photo, pos: 0 },
          { p: photos[(at + 1) % n], pos: 1 },
        ];
  const taken = photo.takenAt ? new Date(photo.takenAt) : null;
  return (
    <div
      className="photo-full"
      role="dialog"
      aria-label="Photo. Tap to close; swipe or use the arrow keys for the next photo."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="photo-track" ref={track}>
        {slides.map(({ p, pos }) => (
          <img
            key={n === 2 && pos !== 0 ? `${p.key}:${pos}` : p.key}
            src={p.fullUrl}
            alt={pos === 0 ? p.caption : ""}
            draggable={false}
            style={{ transform: `translateX(calc(${pos * 100}% + ${pos * GAP}px))` }}
          />
        ))}
      </div>
      <span className="photo-full-caption">
        {photo.caption}
        {photo.caption && taken ? " · " : ""}
        {taken?.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        {n > 1 && <span className="photo-full-count">{`${at + 1} / ${n}`}</span>}
      </span>
    </div>
  );
}

export type Toast = { id: number; text: string; undo?: () => void; error?: boolean };

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.error ? " is-error" : ""}`}>
          <span>{t.text}</span>
          {t.undo && (
            <button
              className="toast-undo"
              onClick={() => {
                t.undo!();
                onDismiss(t.id);
              }}
            >
              Undo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
