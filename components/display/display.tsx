"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  addDays,
  eventEnd,
  eventStart,
  isOutdoor,
  monthGrid,
  startOfDay,
  startOfWeek,
  ymd,
  type CalEvent,
  type RsvpStatus,
} from "@/lib/calendar-model";
import { eventForecast, type Weather } from "@/lib/weather-model";
import type { CalendarRow } from "@/lib/google";
import { api, ApiError, store } from "@/lib/client/api";
import { fmtMonthYear, fmtTime, googleStatusText, initials } from "@/lib/format";
import { ChevronIcon, GearIcon, PlusIcon } from "@/components/icons";
import { PinPad } from "@/components/pin-pad";
import { CalendarGrid } from "./calendar-grid";
import { InfoCard } from "./info-card";
import { Mosaic } from "./mosaic";
import { EditPanel, type Scope } from "./edit-panel";
import { ForecastSheet, PhotoViewer, Toasts, type Toast } from "./overlays";
import {
  applyDraft,
  draftFromEvent,
  draftTimes,
  draftToInput,
  newDraft,
  nextHalfHour,
  type Draft,
} from "./draft";
import { isNight, useNow, useOnline, useVisible, useWakeLock } from "./hooks";
import type { Config, EventsResponse, Photo } from "./types";

const POLL_MS = 60_000;
const UNDO_MS = 8_000;
const PENDING_KEY = "famcal.pendingDeletes";
const FILTER_KEY = "famcal.accountFilter";
const LAST_RELOAD_KEY = "famcal.lastReload";

type PendingDelete = {
  id: string;
  key: string;
  recurringEventId?: string;
  scope: Scope;
  notify: boolean;
  ref: { accountId: string; calendarId: string; eventId: string; recurringEventId?: string };
};
type Op = { id: number; apply: (events: CalEvent[]) => CalEvent[] };
export type Slot = { start: Date; end: Date; allDay?: boolean };
type Panel = { event: CalEvent | null; draft: Draft; slot: Slot | null };
type Reschedule = { event: CalEvent; start: Date; end: Date };

// Same event (by Google ID, which survives a time change) with new times, for optimistic updates.
const withTimes = (events: CalEvent[], r: Reschedule) =>
  events.map((e) =>
    e.id === r.event.id && e.calendarId === r.event.calendarId && e.accountId === r.event.accountId
      ? { ...e, start: r.start.toISOString(), end: r.end.toISOString() }
      : e,
  );

const writable = (c: CalendarRow) => c.accessRole === "owner" || c.accessRole === "writer";
const calKey = (accountId: string, calendarId: string) => `${accountId}\n${calendarId}`;

export function Display() {
  const now = useNow(15_000);
  const online = useOnline();
  const visible = useVisible();

  const [config, setConfig] = useState<Config | null>(null);
  const [data, setData] = useState<EventsResponse | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosFailed, setPhotosFailed] = useState(false);

  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<"week" | "day">("week");
  const [filter, setFilter] = useState<string>("all");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [pending, setPending] = useState<PendingDelete[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState<Photo | null>(null);
  const [pinPrompt, setPinPrompt] = useState<((ok: boolean) => void) | null>(null);
  const [reschedulePrompt, setReschedulePrompt] = useState<Reschedule | null>(null);

  const opSeq = useRef(0);
  const deleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const offline = !online || fetchFailed;
  const night = config ? isNight(now, config.nightStart, config.nightEnd) : false;

  // ---- toasts ----
  const toast = useCallback((t: Omit<Toast, "id">, ms = 5000) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), ms);
  }, []);

  // ---- range: the visible week (or day) plus the month grid, for the dots (FR-19) ----
  const weekStart = view === "week" ? startOfWeek(anchor) : anchor;
  const days = useMemo(
    () => (view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [anchor]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, weekStart.getTime(), anchor.getTime()],
  );
  const month = useMemo(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1), [anchor]);
  // The month calendar can page away from the week on show. Paging is tied to the anchor it started
  // from, so moving the week (swipe, Today, tapping a day) brings the month calendar back with it.
  const [browse, setBrowse] = useState<{ month: number; anchor: number } | null>(null);
  const shownMonth = useMemo(
    () => (browse && browse.anchor === anchor.getTime() ? new Date(browse.month) : month),
    [browse, anchor, month],
  );
  const browsing = shownMonth.getTime() !== month.getTime();
  const shiftMonth = (dir: 1 | -1) =>
    setBrowse({
      month: new Date(shownMonth.getFullYear(), shownMonth.getMonth() + dir, 1).getTime(),
      anchor: anchor.getTime(),
    });
  // Events for a paged-to month, for its dots only; the week view keeps its own range.
  const [monthEvents, setMonthEvents] = useState<{ month: number; events: CalEvent[] } | null>(null);
  const range = useMemo(() => {
    const grid = monthGrid(month);
    const ws = startOfWeek(anchor);
    const from = Math.min(grid[0].getTime(), ws.getTime());
    const to = Math.max(addDays(grid[grid.length - 1], 1).getTime(), addDays(ws, 7).getTime());
    return { timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString() };
  }, [month, anchor]);

  // ---- data loading ----
  const loadEvents = useCallback(async () => {
    try {
      const res = await api<EventsResponse>(
        `/api/events?timeMin=${encodeURIComponent(range.timeMin)}&timeMax=${encodeURIComponent(range.timeMax)}`,
      );
      setData(res);
      setFetchFailed(false);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status >= 500) setFetchFailed(true);
    }
  }, [range]);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await api<Config>("/api/config"));
    } catch {
      // keep the last config
    }
  }, []);

  const loadWeather = useCallback(async () => {
    try {
      setWeather((await api<{ weather: Weather | null }>("/api/weather")).weather);
    } catch {
      // keep the last reading; it greys out after 2 h
    }
  }, []);

  const loadPhotos = useCallback(async () => {
    try {
      const r = await api<{ photos: Photo[]; failed: boolean }>("/api/photos");
      setPhotos((prev) => (prev.length && !r.photos.length ? prev : r.photos));
      setPhotosFailed(r.failed);
    } catch {
      // keep the current set
    }
  }, []);

  // The loaders below set state only after their fetch resolves, and the account filter comes from
  // localStorage, which isn't readable during server render; the set-state-in-effect rule can't see that.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    void loadConfig();
    void loadWeather();
    void loadPhotos();
    setFilter(store.get(FILTER_KEY, "all"));
    /* eslint-enable react-hooks/set-state-in-effect */
    const params = new URLSearchParams(window.location.search);
    const g = googleStatusText(params.get("google") ?? undefined);
    if (g) {
      toast(g, g.error ? 15_000 : 5000);
      window.history.replaceState(null, "", "/");
    }
    // The service worker caches /_next/static cache-first, which is only safe with production's hashed
    // file names. In development it would serve stale code and CSS, so remove it there instead.
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      } else {
        void navigator.serviceWorker
          .getRegistrations()
          .then((regs) => Promise.all(regs.map((r) => r.unregister())))
          .then(() => caches.keys())
          .then((keys) =>
            Promise.all(keys.filter((k) => k.startsWith("famcal-")).map((k) => caches.delete(k))),
          )
          .catch(() => undefined);
      }
    }
  }, [loadConfig, loadWeather, loadPhotos, toast]);

  // Load the dots for a month paged to in the month calendar.
  const shownMonthTime = shownMonth.getTime();
  useEffect(() => {
    if (!browsing) return;
    const grid = monthGrid(new Date(shownMonthTime));
    const timeMin = grid[0].toISOString();
    const timeMax = addDays(grid[grid.length - 1], 1).toISOString();
    let live = true;
    api<EventsResponse>(
      `/api/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
    )
      .then((res) => live && setMonthEvents({ month: shownMonthTime, events: res.events }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [browsing, shownMonthTime]);

  // Poll events every 60 s while visible (FR-16); weather every 15 min; photos hourly; config every 10 min.
  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    void loadEvents();
    const t = setInterval(loadEvents, POLL_MS);
    return () => clearInterval(t);
  }, [visible, loadEvents]);
  useEffect(() => {
    const w = setInterval(loadWeather, 15 * 60_000);
    const p = setInterval(loadPhotos, 60 * 60_000);
    const c = setInterval(loadConfig, 10 * 60_000);
    return () => [w, p, c].forEach(clearInterval);
  }, [loadWeather, loadPhotos, loadConfig]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    if (online) void loadEvents();
  }, [online, loadEvents]);

  // ---- night theme, wake lock, nightly reload ----
  useEffect(() => {
    document.documentElement.dataset.theme = night ? "dark" : "light";
  }, [night]);
  useWakeLock(!night);

  // ---- pending deletes (FR-13): hidden at once, sent when the undo window ends ----
  const sendDelete = useCallback(
    async (p: PendingDelete) => {
      deleteTimers.current.delete(p.id);
      store.set(
        PENDING_KEY,
        store.get<PendingDelete[]>(PENDING_KEY, []).filter((x) => x.id !== p.id),
      );
      try {
        await api("/api/events", {
          body: { action: "delete", ref: p.ref, scope: p.scope, notify: p.notify },
        });
        await loadEvents();
      } catch {
        toast({ text: "Couldn't delete the event.", error: true });
      } finally {
        setPending((all) => all.filter((x) => x.id !== p.id));
      }
    },
    [loadEvents, toast],
  );

  // Deletes left over from a reload during the undo window are sent on start (once, not on every
  // range change: by then storage also holds deletes still inside their undo window).
  const leftoversSent = useRef(false);
  useEffect(() => {
    if (leftoversSent.current) return;
    leftoversSent.current = true;
    const leftover = store.get<PendingDelete[]>(PENDING_KEY, []);
    if (leftover.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from localStorage after hydration
      setPending(leftover);
      leftover.forEach((p) => void sendDelete(p));
    }
  }, [sendDelete]);

  useEffect(() => {
    // Reload once a night at 3:00 to clear memory, after flushing pending deletes.
    if (now.getHours() !== 3 || now.getMinutes() > 5) return;
    const today = ymd(now);
    if (store.get(LAST_RELOAD_KEY, "") === today || pending.length || panel) return;
    store.set(LAST_RELOAD_KEY, today);
    window.location.reload();
  }, [now, pending.length, panel]);

  // ---- derived view data ----
  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const calendars = useMemo(() => data?.calendars ?? [], [data]);
  const calByKey = useMemo(
    () => new Map(calendars.map((c) => [calKey(c.accountId, c.calendarId), c])),
    [calendars],
  );
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const keywords = useMemo(() => config?.outdoorKeywords ?? [], [config]);

  const events = useMemo(() => {
    let list = ops.reduce((acc, op) => op.apply(acc), data?.events ?? []);
    if (reschedulePrompt) list = withTimes(list, reschedulePrompt);
    const hiddenKeys = new Set(pending.map((p) => p.key));
    const hiddenSeries = new Set(
      pending.filter((p) => p.scope === "all" && p.recurringEventId).map((p) => p.recurringEventId),
    );
    list = list.filter(
      (e) => !hiddenKeys.has(e.key) && !(e.recurringEventId && hiddenSeries.has(e.recurringEventId)),
    );
    if (filter !== "all") list = list.filter((e) => e.accountIds.includes(filter));
    return list;
  }, [data, ops, pending, filter, reschedulePrompt]);

  const colorOf = useCallback(
    (e: CalEvent) => calByKey.get(calKey(e.accountId, e.calendarId))?.color ?? "#4A5560",
    [calByKey],
  );

  // Account badges in the merged view: when two accounts share a colour, or an event is on both (FR-53/54).
  const sharedColors = useMemo(() => {
    const owners = new Map<string, Set<string>>();
    calendars
      .filter((c) => c.selected)
      .forEach((c) => owners.set(c.color, (owners.get(c.color) ?? new Set()).add(c.accountId)));
    return new Set([...owners].filter(([, s]) => s.size > 1).map(([color]) => color));
  }, [calendars]);
  const badgesOf = useCallback(
    (e: CalEvent) => {
      if (filter !== "all" || accounts.length < 2) return [];
      const ids = e.accountIds.length > 1 ? e.accountIds : sharedColors.has(colorOf(e)) ? [e.accountId] : [];
      return ids.map((id) => initials(accountById.get(id)?.name || accountById.get(id)?.email || "?"));
    },
    [filter, accounts.length, sharedColors, colorOf, accountById],
  );

  const forecastOf = useCallback(
    (e: CalEvent) => {
      if (e.allDay || e.busy || !isOutdoor(e, keywords)) return null;
      const s = eventStart(e);
      if (s.getTime() > now.getTime() + 7 * 86_400_000 || eventEnd(e) < now) return null;
      return eventForecast(weather, s);
    },
    [keywords, now, weather],
  );

  const dots = useMemo(() => {
    const map = new Map<string, string[]>();
    const source = browsing
      ? monthEvents?.month === shownMonth.getTime()
        ? monthEvents.events.filter((e) => filter === "all" || e.accountIds.includes(filter))
        : []
      : events;
    for (const e of source) {
      const color = colorOf(e);
      const s = startOfDay(eventStart(e));
      const end = eventEnd(e);
      for (let d = s; d < end || ymd(d) === ymd(s); d = addDays(d, 1)) {
        const k = ymd(d);
        const list = map.get(k) ?? [];
        if (!list.includes(color)) list.push(color);
        map.set(k, list);
        if (d.getTime() - s.getTime() > 62 * 86_400_000) break;
      }
    }
    return map;
  }, [events, colorOf, browsing, monthEvents, shownMonth, filter]);

  const panelCalendars = useMemo(() => {
    const w = calendars.filter((c) => writable(c) && accountById.has(c.accountId));
    const shown = w.filter((c) => c.selected);
    return shown.length ? shown : w;
  }, [calendars, accountById]);

  const defaultCalendar = useCallback(() => {
    const account = filter !== "all" ? filter : accounts.find((a) => a.isFamily)?.id;
    const pick =
      panelCalendars.find((c) => c.accountId === account && c.isPrimary) ??
      panelCalendars.find((c) => c.accountId === account) ??
      panelCalendars[0];
    return pick ? { accountId: pick.accountId, calendarId: pick.calendarId } : null;
  }, [filter, accounts, panelCalendars]);

  const legend = useMemo(
    () => calendars.filter((c) => c.selected && (filter === "all" || c.accountId === filter)),
    [calendars, filter],
  );
  const reconnect = accounts.filter((a) => a.status === "reconnect" || data?.failedAccounts.includes(a.id));

  // ---- actions ----
  const openNew = (at: Date | null, until?: Date) => {
    if (offline) return;
    const cal = defaultCalendar();
    if (!cal) return toast({ text: "No calendar you can add to. Check Settings.", error: true });
    const start = at ?? nextHalfHour(new Date());
    const draft = newDraft(start, cal, until);
    setPanel({ event: null, draft, slot: at ? draftTimes(draft) : null });
  };

  // A new event's range, shared by the grid highlight and the panel's time fields.
  const syncSlot = useCallback((start: Date, end: Date, allDay = false) => {
    setPanel((p) =>
      p &&
      !p.event &&
      (p.slot?.start.getTime() !== start.getTime() ||
        p.slot?.end.getTime() !== end.getTime() ||
        !!p.slot?.allDay !== allDay)
        ? { ...p, slot: { start, end, allDay } }
        : p,
    );
  }, []);

  const openEvent = (e: CalEvent) => setPanel({ event: e, draft: draftFromEvent(e, keywords), slot: null });

  const closePanel = useCallback(() => setPanel(null), []);

  // Escape (hardware keyboard) closes whatever is on top, one layer per press.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pinPrompt) return; // the PIN pad handles its own keys, Escape included
      if (reschedulePrompt) setReschedulePrompt(null);
      else if (photoOpen) setPhotoOpen(null);
      else if (forecastOpen) setForecastOpen(false);
      else if (panel) closePanel();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinPrompt, reschedulePrompt, photoOpen, forecastOpen, panel, closePanel]);

  const runOp = async (apply: Op["apply"], call: () => Promise<unknown>, failText: string) => {
    const id = ++opSeq.current;
    setOps((all) => [...all, { id, apply }]);
    try {
      await call();
      await loadEvents();
      return true;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      toast({
        text:
          code === "pin_required"
            ? "Adding that guest needs the PIN."
            : code === "reconnect"
              ? "Reconnect Google in Settings."
              : failText,
        error: true,
      });
      return false;
    } finally {
      setOps((all) => all.filter((o) => o.id !== id));
    }
  };

  const save = (draft: Draft, scope: Scope, guestsChanged: boolean) => {
    const target = panel?.event ?? null;
    setPanel(null);
    const input = draftToInput(draft, guestsChanged);
    if (!target) {
      const temp = applyDraft(
        {
          key: `temp:${Date.now()}`,
          id: "",
          accountId: draft.accountId,
          calendarId: draft.calendarId,
          accountIds: [draft.accountId],
          title: "",
          start: "",
          end: "",
          allDay: false,
          outdoor: null,
          busy: false,
          canEdit: false,
          canRsvp: false,
          organizerSelf: true,
          attendees: [],
          guestsCanInviteOthers: true,
          guestsCanSeeOtherGuests: true,
          guestsCanModify: false,
        },
        draft,
      );
      void runOp(
        (evs) => [...evs, temp],
        () =>
          api("/api/events", {
            body: {
              action: "create",
              accountId: draft.accountId,
              calendarId: draft.calendarId,
              event: input,
            },
          }),
        "Couldn't save the event.",
      );
      return;
    }
    void runOp(
      (evs) => evs.map((e) => (e.key === target.key ? applyDraft(e, draft) : e)),
      () =>
        api("/api/events", {
          body: {
            action: "update",
            scope,
            event: input,
            ref: {
              accountId: target.accountId,
              calendarId: target.calendarId,
              eventId: target.id,
              recurringEventId: target.recurringEventId,
            },
          },
        }),
      "Couldn't save the changes.",
    );
  };

  // Drag to resize on the grid. Only the times change; repeating events ask which ones first.
  const reschedule = (event: CalEvent, start: Date, end: Date) => {
    if (offline) return;
    if (event.recurringEventId) setReschedulePrompt({ event, start, end });
    else void sendReschedule({ event, start, end }, "this");
  };

  const sendReschedule = async (r: Reschedule, scope: Scope, undoable = true) => {
    const ok = await runOp(
      (evs) => withTimes(evs, r),
      () =>
        api("/api/events", {
          body: {
            action: "reschedule",
            scope,
            start: r.start.toISOString(),
            end: r.end.toISOString(),
            ref: {
              accountId: r.event.accountId,
              calendarId: r.event.calendarId,
              eventId: r.event.id,
              recurringEventId: r.event.recurringEventId,
            },
          },
        }),
      "Couldn't change the time.",
    );
    // Undo puts the old times back. Not offered for a whole series: its occurrences get new IDs.
    if (ok && undoable && scope === "this") {
      toast(
        {
          text: `“${r.event.title}” ${fmtTime(r.start)} – ${fmtTime(r.end)}`,
          undo: () =>
            void sendReschedule(
              { event: r.event, start: eventStart(r.event), end: eventEnd(r.event) },
              "this",
              false,
            ),
        },
        UNDO_MS,
      );
    }
  };

  const remove = (scope: Scope, notify: boolean) => {
    const target = panel?.event;
    if (!target) return;
    setPanel(null);
    const p: PendingDelete = {
      id: `${Date.now()}`,
      key: target.key,
      recurringEventId: target.recurringEventId,
      scope,
      notify,
      ref: {
        accountId: target.accountId,
        calendarId: target.calendarId,
        eventId: target.id,
        recurringEventId: target.recurringEventId,
      },
    };
    setPending((all) => [...all, p]);
    store.set(PENDING_KEY, [...store.get<PendingDelete[]>(PENDING_KEY, []), p]);
    deleteTimers.current.set(
      p.id,
      setTimeout(() => void sendDelete(p), UNDO_MS),
    );
    toast(
      {
        text: `Deleted “${target.title}”`,
        undo: () => {
          clearTimeout(deleteTimers.current.get(p.id));
          deleteTimers.current.delete(p.id);
          store.set(
            PENDING_KEY,
            store.get<PendingDelete[]>(PENDING_KEY, []).filter((x) => x.id !== p.id),
          );
          setPending((all) => all.filter((x) => x.id !== p.id));
        },
      },
      UNDO_MS,
    );
  };

  const respond = (status: RsvpStatus) => {
    const target = panel?.event;
    if (!target) return;
    setPanel(null);
    void runOp(
      (evs) =>
        evs.map((e) =>
          e.key === target.key
            ? { ...e, attendees: e.attendees.map((a) => (a.self ? { ...a, status } : a)) }
            : e,
        ),
      () =>
        api("/api/events", {
          body: {
            action: "rsvp",
            status,
            ref: { accountId: target.accountId, calendarId: target.calendarId, eventId: target.id },
          },
        }),
      "Couldn't send your reply.",
    );
  };

  const requestPin = useCallback(async () => {
    try {
      if ((await api<{ unlocked: boolean }>("/api/pin")).unlocked) return true;
    } catch {
      return false;
    }
    return new Promise<boolean>((resolve) => setPinPrompt(() => resolve));
  }, []);

  const step = (dir: 1 | -1) =>
    setAnchor((a) => addDays(view === "week" ? startOfWeek(a) : a, dir * (view === "week" ? 7 : 1)));
  const goToday = () => {
    setAnchor(startOfDay(new Date()));
    setView("week");
  };
  const pickFilter = (f: string) => {
    setFilter(f);
    store.set(FILTER_KEY, f);
  };

  const syncedAt = data ? fmtTime(new Date(data.syncedAt)) : "";

  return (
    <div className={`canvas${night ? " is-night" : ""}`}>
      <div className="left-col">
        <InfoCard
          now={now}
          weather={weather}
          weekStart={startOfWeek(anchor)}
          month={shownMonth}
          dots={dots}
          onShiftMonth={shiftMonth}
          onPickDate={(d) => {
            setAnchor(d);
            setView("week");
          }}
          onOpenForecast={() => setForecastOpen(true)}
        />
        <Mosaic
          key={photos.map((p) => p.key).join(",")}
          photos={photos}
          rotationSeconds={config?.rotationSeconds ?? 20}
          caption={config?.photoSourceName ?? ""}
          onOpen={setPhotoOpen}
        />
        {forecastOpen && weather && (
          <ForecastSheet weather={weather} now={now} onClose={() => setForecastOpen(false)} />
        )}
        {panel && (
          <EditPanel
            key={panel.event?.key ?? `new-${panel.draft.day}-${panel.draft.start}`}
            event={panel.event}
            initial={panel.draft}
            times={panel.event ? null : panel.slot}
            onTimes={syncSlot}
            accounts={accounts}
            calendars={panelCalendars}
            keywords={keywords}
            family={config?.familyMembers ?? []}
            recentGuests={config?.recentGuests ?? []}
            weather={weather}
            offline={offline}
            onSave={save}
            onDelete={remove}
            onRsvp={respond}
            onClose={closePanel}
            requestPin={requestPin}
          />
        )}
      </div>

      <main className="right-panel">
        <header className="cal-header">
          <div className="cal-nav">
            <h1 className="cal-month">{fmtMonthYear(view === "week" ? addDays(weekStart, 3) : anchor)}</h1>
            <button
              className="icon-btn icon-btn-44"
              aria-label={view === "week" ? "Previous week" : "Previous day"}
              onClick={() => step(-1)}
            >
              <ChevronIcon dir="left" />
            </button>
            <button
              className="icon-btn icon-btn-44"
              aria-label={view === "week" ? "Next week" : "Next day"}
              onClick={() => step(1)}
            >
              <ChevronIcon dir="right" />
            </button>
            <button className="btn btn-quiet" onClick={goToday}>
              Today
            </button>
            {view === "day" && (
              <button className="btn btn-quiet" onClick={() => setView("week")}>
                Week
              </button>
            )}
          </div>

          {accounts.length >= 2 && (
            <div className="switcher" role="tablist" aria-label="Accounts">
              <button
                role="tab"
                aria-selected={filter === "all"}
                className={filter === "all" ? "is-on" : ""}
                onClick={() => pickFilter("all")}
              >
                All
              </button>
              {accounts.map((a) => (
                <button
                  key={a.id}
                  role="tab"
                  aria-selected={filter === a.id}
                  aria-label={a.name || a.email}
                  className={filter === a.id ? "is-on" : ""}
                  onClick={() => pickFilter(a.id)}
                >
                  {initials(a.name || a.email)}
                </button>
              ))}
            </div>
          )}

          <div className="cal-actions">
            <Link className="icon-btn icon-btn-44" href="/settings" aria-label="Settings">
              <GearIcon />
            </Link>
            <button className="btn btn-primary btn-add" onClick={() => openNew(null)} disabled={offline}>
              <PlusIcon /> Add
            </button>
          </div>
        </header>

        <CalendarGrid
          days={days}
          events={events}
          now={now}
          selectedKey={panel?.event?.key ?? null}
          slot={panel && !panel.event ? panel.slot : null}
          colorOf={colorOf}
          badgesOf={badgesOf}
          forecastOf={forecastOf}
          onTapEvent={openEvent}
          onTapSlot={(at) => openNew(at)}
          onCreateRange={(start, end) => openNew(start, end)}
          onReschedule={reschedule}
          onSlotChange={syncSlot}
          onOpenDay={(d) => {
            setAnchor(startOfDay(d));
            setView("day");
          }}
          onSwipe={step}
        />

        <footer className="cal-footer">
          <div className="legend">
            {legend.map((c) => (
              <span key={calKey(c.accountId, c.calendarId)} className="legend-item">
                <span className="dot dot-12" style={{ background: c.color }} />
                {c.summary}
              </span>
            ))}
          </div>
          <div className="sync-status">
            {reconnect.length > 0 && (
              <Link href="/settings" className="reconnect">
                Reconnect Google
                {accounts.length > 1
                  ? ` (${reconnect.map((a) => initials(a.name || a.email)).join(", ")})`
                  : ""}
              </Link>
            )}
            {photosFailed && <span className="muted">Photos: showing saved set</span>}
            <span>
              {offline
                ? `Offline · last synced ${syncedAt || "—"}`
                : syncedAt
                  ? `Synced ${syncedAt}`
                  : "Syncing…"}
            </span>
          </div>
        </footer>
        {reschedulePrompt && (
          <div className="scope-prompt" role="dialog" aria-label="Repeating event">
            <span>
              Change “{reschedulePrompt.event.title}” to {fmtTime(reschedulePrompt.start)} –{" "}
              {fmtTime(reschedulePrompt.end)} for
            </span>
            <button
              className="btn btn-chip"
              onClick={() => {
                setReschedulePrompt(null);
                void sendReschedule(reschedulePrompt, "this");
              }}
            >
              This event
            </button>
            <button
              className="btn btn-chip"
              onClick={() => {
                setReschedulePrompt(null);
                void sendReschedule(reschedulePrompt, "all");
              }}
            >
              All events
            </button>
            <button className="btn btn-quiet" onClick={() => setReschedulePrompt(null)}>
              Cancel
            </button>
          </div>
        )}
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((all) => all.filter((t) => t.id !== id))} />
      </main>

      {photoOpen && <PhotoViewer photo={photoOpen} onClose={() => setPhotoOpen(null)} />}
      {pinPrompt && (
        <PinPad
          title="PIN needed to invite this address"
          onDone={() => {
            pinPrompt(true);
            setPinPrompt(null);
          }}
          onCancel={() => {
            pinPrompt(false);
            setPinPrompt(null);
          }}
        />
      )}
    </div>
  );
}
