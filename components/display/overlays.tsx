"use client";

import { useEffect } from "react";
import { describeCode, type Weather } from "@/lib/weather-model";
import { WeatherIcon } from "@/components/icons";
import type { Photo } from "./types";

function useAutoClose(onClose: () => void, ms = 30_000) {
  useEffect(() => {
    const t = setTimeout(onClose, ms);
    return () => clearTimeout(t);
  }, [onClose, ms]);
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
                <WeatherIcon kind={describeCode(h.code).icon} size={28} />
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

export function PhotoViewer({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  useAutoClose(onClose);
  const taken = photo.takenAt ? new Date(photo.takenAt) : null;
  return (
    <button className="photo-full" onClick={onClose} aria-label="Close photo">
      <img src={photo.fullUrl} alt={photo.caption} />
      {(photo.caption || taken) && (
        <span className="photo-full-caption">
          {photo.caption}
          {photo.caption && taken ? " · " : ""}
          {taken?.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </span>
      )}
    </button>
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
