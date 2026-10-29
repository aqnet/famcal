"use client";

import { useEffect, useRef, useState } from "react";
import { guessOutdoor, ymd, type CalEvent, type RsvpStatus } from "@/lib/calendar-model";
import type { Account, CalendarRow } from "@/lib/google";
import { eventForecast, type Weather } from "@/lib/weather-model";
import { fmtDateLong, fmtTimeShort, hhmm } from "@/lib/format";
import { CloseIcon, WeatherIcon } from "@/components/icons";
import { describeCode } from "@/lib/weather-model";
import { DEFAULT_REMIND, draftTimes, REMIND_ALL_DAY, REMIND_TIMED, remindLabel, type Draft } from "./draft";

const IDLE_MS = 60_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Scope = "this" | "all";

export function EditPanel({
  event,
  initial,
  times,
  onTimes,
  accounts,
  calendars,
  keywords,
  family,
  recentGuests,
  weather,
  offline,
  onSave,
  onDelete,
  onRsvp,
  onClose,
  requestPin,
}: {
  event: CalEvent | null; // null = new event
  initial: Draft;
  times: { start: Date; end: Date; allDay?: boolean } | null; // new event: what the grid highlights
  onTimes: (start: Date, end: Date, allDay: boolean) => void;
  accounts: Account[];
  calendars: CalendarRow[]; // writable calendars to offer
  keywords: string[];
  family: { name: string; email: string }[];
  recentGuests: string[];
  weather: Weather | null;
  offline: boolean;
  onSave: (draft: Draft, scope: Scope, guestsChanged: boolean) => void;
  onDelete: (scope: Scope, notify: boolean) => void;
  onRsvp: (status: RsvpStatus) => void;
  onClose: () => void;
  requestPin: () => Promise<boolean>;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [more, setMore] = useState(!!(initial.location || initial.description || initial.guests.length));
  const [confirm, setConfirm] = useState<"save" | "delete" | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");

  // Keep the grid's highlight and these times in step: stretching the highlight updates the fields
  // (adjusted during render, React's pattern for following a prop), and editing the fields moves it.
  const [seenTimes, setSeenTimes] = useState(times);
  if (times !== seenTimes) {
    setSeenTimes(times);
    if (times && !times.allDay && !d.allDay) {
      const cur = draftTimes(d);
      if (cur.start.getTime() !== times.start.getTime() || cur.end.getTime() !== times.end.getTime()) {
        setD({
          ...d,
          day: ymd(times.start),
          start: hhmm(times.start),
          end: hhmm(times.end),
          endDayOffset: ymd(times.end) === ymd(times.start) ? 0 : 1,
        });
      }
    }
  }
  useEffect(() => {
    if (event) return;
    const { start, end } = draftTimes(d);
    onTimes(start, end, d.allDay);
  }, [event, d, onTimes]);

  const isNew = event === null;
  const editable = isNew || event.canEdit;
  const recurring = !!event?.recurringEventId;
  const guestsChanged = d.guests.join(",") !== initial.guests.join(",");

  // Close after 60 s with no input (FR-18), so the display doesn't sit on a half-finished edit.
  const lastInput = useRef(0);
  useEffect(() => {
    lastInput.current = Date.now();
  }, []);
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - lastInput.current > IDLE_MS) onClose();
    }, 5000);
    return () => clearInterval(t);
  }, [onClose]);
  const touch = () => (lastInput.current = Date.now());

  const set = (patch: Partial<Draft>) =>
    setD((prev) => {
      const next = { ...prev, ...patch };
      if (patch.title !== undefined && !prev.outdoorTouched)
        next.outdoor = guessOutdoor(next.title, keywords);
      // 10 minutes before an all-day event is 11:50 the night before: switch to that kind's default.
      if (patch.allDay !== undefined && patch.allDay !== prev.allDay) {
        const fits = (patch.allDay ? REMIND_ALL_DAY : REMIND_TIMED).includes(prev.remindMinutes);
        if (!fits) {
          next.remindMinutes = patch.allDay ? DEFAULT_REMIND.allDay : DEFAULT_REMIND.timed;
          next.remindTouched ||= prev.remind;
        }
      }
      return next;
    });

  const setDuration = (mins: number) => {
    const { start } = draftTimes(d);
    const end = new Date(start.getTime() + mins * 60_000);
    set({ allDay: false, end: hhmm(end), endDayOffset: end.getDate() !== start.getDate() ? 1 : 0 });
  };

  const addGuest = async (email: string, known: boolean) => {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e) || d.guests.includes(e)) return;
    if (!known && !(await requestPin())) return; // unknown addresses need the PIN (FR-60)
    set({ guests: [...d.guests, e] });
    setTyped("");
  };

  const save = (scope?: Scope) => {
    if (!d.title.trim()) return setError("Give the event a name.");
    if (recurring && !scope) return setConfirm("save");
    onSave(d, scope ?? "this", guestsChanged);
  };
  const del = (scope?: Scope) => {
    if (recurring && !scope) return setConfirm("delete");
    onDelete(scope ?? "this", event?.attendees.length ? true : false);
  };

  const { start, end: endsAt } = draftTimes(d);
  const minutes = Math.round((endsAt.getTime() - start.getTime()) / 60_000);
  const forecast = d.outdoor ? eventForecast(weather, start) : null;
  const hourCode =
    forecast && weather?.hourly.find((h) => h.time.slice(0, 13) === `${d.day}T${d.start.slice(0, 2)}`)?.code;
  const multiAccount = new Set(calendars.map((c) => c.accountId)).size > 1;
  const knownEmails = new Set([...family.map((f) => f.email), ...recentGuests]);
  const title = isNew ? "New event" : editable ? "Edit event" : "Event";

  return (
    <aside
      className="edit-panel"
      role="dialog"
      aria-label={title}
      onPointerDown={touch}
      onKeyDown={touch}
      onInput={touch}
    >
      <header className="panel-head">
        <button className="icon-btn icon-btn-48" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
        <h2 className="panel-title">{title}</h2>
        {editable ? (
          <button className="btn btn-primary btn-save" onClick={() => save()} disabled={offline}>
            Save
          </button>
        ) : (
          <span className="panel-head-spacer" />
        )}
      </header>

      <div
        className="panel-body"
        onFocusCapture={(e) =>
          setTimeout(
            () => (e.target as HTMLElement).scrollIntoView?.({ block: "center", behavior: "smooth" }),
            300,
          )
        }
      >
        {confirm && (
          <div className="scope-row" role="group" aria-label="Repeating event">
            <span>{confirm === "save" ? "Save changes to" : "Delete"}</span>
            <button
              className="btn btn-chip"
              onClick={() => (confirm === "save" ? save("this") : del("this"))}
            >
              This event
            </button>
            <button className="btn btn-chip" onClick={() => (confirm === "save" ? save("all") : del("all"))}>
              All events
            </button>
            <button className="btn-text" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        )}
        {offline && <p className="panel-note">Offline: changes are disabled until the connection returns.</p>}

        {!editable ? (
          <Detail event={event!} onRsvp={onRsvp} />
        ) : (
          <>
            <label className="field">
              <span className="field-label">What</span>
              <input
                className="input"
                value={d.title}
                onChange={(e) => {
                  setError("");
                  set({ title: e.target.value });
                }}
                placeholder="Event name"
                autoFocus={isNew}
                enterKeyHint="done"
              />
            </label>
            {error && <p className="field-error">{error}</p>}

            <div className="field">
              <span className="field-label">When</span>
              <div className={`when-row${d.allDay ? " is-allday" : ""}`}>
                <input
                  className="input"
                  type="date"
                  aria-label="Day"
                  value={d.day}
                  onChange={(e) => e.target.value && set({ day: e.target.value })}
                />
                {!d.allDay && (
                  <>
                    <input
                      className="input"
                      type="time"
                      aria-label="Start"
                      step={300}
                      value={d.start}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        // keep the duration when the start moves
                        const before = draftTimes(d);
                        const dur = before.end.getTime() - before.start.getTime();
                        const [h, m] = e.target.value.split(":").map(Number);
                        const s = new Date(before.start);
                        s.setHours(h, m);
                        const en = new Date(s.getTime() + dur);
                        set({
                          start: e.target.value,
                          end: hhmm(en),
                          endDayOffset: Math.round(
                            (new Date(en.getFullYear(), en.getMonth(), en.getDate()).getTime() -
                              new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime()) /
                              86_400_000,
                          ),
                        });
                      }}
                    />
                    <input
                      className="input"
                      type="time"
                      aria-label="End"
                      step={300}
                      value={d.end}
                      onChange={(e) => e.target.value && set({ end: e.target.value, endDayOffset: 0 })}
                    />
                  </>
                )}
              </div>
              <div className="chips">
                {[
                  ["30 min", 30],
                  ["1 h", 60],
                  ["2 h", 120],
                ].map(([label, mins]) => {
                  // selected whenever the event is that long, however the length was set
                  const on = !d.allDay && minutes === mins;
                  return (
                    <button
                      key={label}
                      className={`btn btn-chip${on ? " is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => setDuration(mins as number)}
                    >
                      {label}
                    </button>
                  );
                })}
                <button
                  className={`btn btn-chip${d.allDay ? " is-on" : ""}`}
                  aria-pressed={d.allDay}
                  onClick={() => set({ allDay: !d.allDay })}
                >
                  All day
                </button>
              </div>
            </div>

            <div className="field">
              <span className="field-label">Calendar</span>
              {groupByAccount(calendars, accounts).map(({ account, cals }) => (
                <div key={account?.id ?? "x"} className="cal-group">
                  {multiAccount && <span className="cal-group-name">{account?.name || account?.email}</span>}
                  <div className="chips">
                    {cals.map((c) => {
                      const on = c.accountId === d.accountId && c.calendarId === d.calendarId;
                      const locked = !isNew && c.accountId !== event!.accountId; // FR-57: moving accounts is v2
                      return (
                        <button
                          key={c.accountId + c.calendarId}
                          className={`btn cal-pill${on ? " is-on" : ""}`}
                          style={
                            on ? { background: c.color, borderColor: c.color } : { borderColor: c.color }
                          }
                          aria-pressed={on}
                          disabled={locked}
                          onClick={() => set({ accountId: c.accountId, calendarId: c.calendarId })}
                        >
                          <span className="dot" style={{ background: on ? "var(--on-event)" : c.color }} />
                          {c.summary}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!isNew && multiAccount && (
                <p className="field-hint">To move an event to another account, delete it and add it again.</p>
              )}
            </div>

            <label className="switch-row">
              <span>
                <span className="switch-title">Outdoor</span>
                <span className="field-hint">Show forecast for this event</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={d.outdoor}
                onChange={(e) => set({ outdoor: e.target.checked, outdoorTouched: true })}
              />
            </label>

            {forecast && (
              <div className="callout">
                <WeatherIcon kind={describeCode(hourCode ?? 3).icon} size={28} />
                <span>Forecast at event time: {forecast.detail}</span>
              </div>
            )}

            <label className="switch-row">
              <span>
                <span className="switch-title">Notify</span>
                <span className="field-hint">Reminder on phones signed in to this calendar</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={d.remind}
                onChange={(e) => set({ remind: e.target.checked, remindTouched: true })}
              />
            </label>
            {d.remind && (
              <div className="chips" role="group" aria-label="Notify before">
                {[...new Set([...(d.allDay ? REMIND_ALL_DAY : REMIND_TIMED), d.remindMinutes])]
                  .sort((a, b) => a - b)
                  .map((mins) => {
                    const on = d.remindMinutes === mins;
                    return (
                      <button
                        key={mins}
                        className={`btn btn-chip${on ? " is-on" : ""}`}
                        aria-pressed={on}
                        onClick={() => set({ remindMinutes: mins, remindTouched: true })}
                      >
                        {remindLabel(mins, d.allDay)}
                      </button>
                    );
                  })}
              </div>
            )}

            <button className="btn-text more-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
              {more ? "Less" : "More"}: location, guests, notes
            </button>

            {more && (
              <>
                <label className="field">
                  <span className="field-label">Location</span>
                  <input
                    className="input"
                    value={d.location}
                    onChange={(e) => set({ location: e.target.value })}
                  />
                </label>

                <div className="field">
                  <span className="field-label">Guests</span>
                  {d.guests.length > 0 && (
                    <div className="chips">
                      {d.guests.map((g) => {
                        const status = event?.attendees.find((a) => a.email === g)?.status;
                        return (
                          <span key={g} className="guest-chip">
                            <span>{family.find((f) => f.email === g)?.name ?? g}</span>
                            {status && <span className={`rsvp rsvp-${status}`}>{RSVP_LABEL[status]}</span>}
                            <button
                              className="icon-btn"
                              aria-label={`Remove ${g}`}
                              onClick={() => set({ guests: d.guests.filter((x) => x !== g) })}
                            >
                              <CloseIcon size={18} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="chips">
                    {family
                      .filter((f) => !d.guests.includes(f.email))
                      .map((f) => (
                        <button
                          key={f.email}
                          className="btn btn-chip"
                          onClick={() => addGuest(f.email, true)}
                        >
                          + {f.name}
                        </button>
                      ))}
                    {recentGuests
                      .filter((g) => !d.guests.includes(g) && !family.some((f) => f.email === g))
                      .slice(0, 6)
                      .map((g) => (
                        <button key={g} className="btn btn-chip is-quiet" onClick={() => addGuest(g, true)}>
                          + {g}
                        </button>
                      ))}
                  </div>
                  <div className="input-with-button">
                    <input
                      className="input"
                      type="email"
                      placeholder="Add email address"
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && addGuest(typed, knownEmails.has(typed.trim().toLowerCase()))
                      }
                    />
                    <button
                      className="btn btn-chip"
                      onClick={() => addGuest(typed, knownEmails.has(typed.trim().toLowerCase()))}
                    >
                      Add
                    </button>
                  </div>
                </div>

                {guestsChanged && (
                  <label className="switch-row">
                    <span className="switch-title">Email invitations</span>
                    <input
                      type="checkbox"
                      role="switch"
                      className="switch"
                      checked={d.sendUpdates}
                      onChange={(e) => set({ sendUpdates: e.target.checked })}
                    />
                  </label>
                )}

                {d.guests.length > 0 && (
                  <fieldset className="perm-group">
                    <legend className="field-label">Guests can</legend>
                    {(
                      [
                        ["guestsCanInviteOthers", "Invite others"],
                        ["guestsCanSeeOtherGuests", "See the guest list"],
                        ["guestsCanModify", "Change the event"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="switch-row">
                        <span>{label}</span>
                        <input
                          type="checkbox"
                          role="switch"
                          className="switch"
                          checked={d[k]}
                          onChange={(e) => set({ [k]: e.target.checked })}
                        />
                      </label>
                    ))}
                  </fieldset>
                )}

                <label className="field">
                  <span className="field-label">Notes</span>
                  <textarea
                    className="input textarea"
                    rows={4}
                    value={d.description}
                    onChange={(e) => set({ description: e.target.value })}
                  />
                </label>
              </>
            )}

            {!isNew && (
              <button className="btn btn-danger btn-block" onClick={() => del()} disabled={offline}>
                Delete event
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

const RSVP_LABEL: Record<RsvpStatus, string> = {
  accepted: "Going",
  declined: "Not going",
  tentative: "Maybe",
  needsAction: "Awaiting",
};

function Detail({ event, onRsvp }: { event: CalEvent; onRsvp: (s: RsvpStatus) => void }) {
  const self = event.attendees.find((a) => a.self);
  const s = new Date(event.allDay ? `${event.start}T00:00` : event.start);
  const e = new Date(event.allDay ? `${event.end}T00:00` : event.end);
  return (
    <div className="detail">
      <h3 className="detail-title">{event.title}</h3>
      <p className="detail-when">
        {fmtDateLong(s)}
        {event.allDay ? " · All day" : ` · ${fmtTimeShort(s)} – ${fmtTimeShort(e)}`}
      </p>
      {event.location && <p className="detail-line">{event.location}</p>}
      {event.description && <p className="detail-notes">{event.description}</p>}
      {event.canRsvp && (
        <div className="field">
          <span className="field-label">Going?</span>
          <div className="chips">
            {(
              [
                ["accepted", "Yes"],
                ["declined", "No"],
                ["tentative", "Maybe"],
              ] as const
            ).map(([status, label]) => (
              <button
                key={status}
                className={`btn btn-chip${self?.status === status ? " is-on" : ""}`}
                aria-pressed={self?.status === status}
                onClick={() => onRsvp(status)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {event.attendees.length > 0 && (
        <ul className="detail-guests">
          {event.attendees.map((a) => (
            <li key={a.email}>
              {a.name ?? a.email} <span className={`rsvp rsvp-${a.status}`}>{RSVP_LABEL[a.status]}</span>
            </li>
          ))}
        </ul>
      )}
      {!event.canRsvp && (
        <p className="field-hint">{event.busy ? "Private event." : "This calendar is view-only."}</p>
      )}
    </div>
  );
}

function groupByAccount(calendars: CalendarRow[], accounts: Account[]) {
  return accounts
    .map((account) => ({ account, cals: calendars.filter((c) => c.accountId === account.id) }))
    .filter((g) => g.cals.length);
}
