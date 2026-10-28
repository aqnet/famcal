"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  addDays,
  eventEnd,
  eventStart,
  layoutAllDay,
  layoutDay,
  startOfDay,
  ymd,
  type CalEvent,
  type TimedPlacement,
} from "@/lib/calendar-model";
import { fmtHour, fmtTimeShort } from "@/lib/format";
import { store } from "@/lib/client/api";
import { reducedMotion, slideIn } from "./hooks";

export const GRID_START = 0; // midnight
export const GRID_END = 24; // midnight
const OPEN_AT = 7; // opens with 7 AM at the top
const VISIBLE_HOURS = 14; // default zoom: 7 AM–9 PM fills the card
const MIN_HOURS = 3; // pinched all the way in
const ZOOM_KEY = "famcal.visibleHours";
const MIN_EVENT = 24;
const HIT = 44;
const SNAP = 15; // minutes
const HOLD_MS = 450; // touch: press and hold before a drag, so plain drags still scroll
const EDGE = 6; // mouse: px at an event's top or bottom edge that resize instead of move

export type ForecastTag = { text: string; rain: boolean } | null;

type Drag = {
  kind: "start" | "end" | "move" | "create";
  pointerId: number;
  day: Date;
  event: CalEvent | null;
  anchorMin: number; // create: where the press began; move: grab point minus the event's start
  startMin: number;
  endMin: number;
  moved: boolean;
};

type Press = {
  x: number;
  y: number;
  id: number;
  slop: number; // px of wander allowed before the press counts as movement
  timer: ReturnType<typeof setTimeout> | null; // null: mouse, where movement itself starts the drag
  begin: (clientY: number) => void;
};

// Stable across time changes, unlike `key` (which includes the start for one-off events).
const idOf = (e: CalEvent) => `${e.accountId}|${e.calendarId}|${e.id}`;

// Timed, editable events that start and end on the same day can be moved and resized on the grid.
const draggable = (e: CalEvent) =>
  e.canEdit &&
  !e.busy &&
  !e.allDay &&
  !e.key.startsWith("temp:") &&
  ymd(eventStart(e)) === ymd(new Date(eventEnd(e).getTime() - 1));

const atMin = (day: Date, min: number) => {
  const d = startOfDay(day);
  d.setMinutes(min);
  return d;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const snapTo = (min: number) => Math.round(min / SNAP) * SNAP;

export function CalendarGrid({
  days,
  events,
  now,
  selectedKey,
  slot,
  colorOf,
  badgesOf,
  forecastOf,
  onTapEvent,
  onTapSlot,
  onCreateRange,
  onReschedule,
  onSlotChange,
  onOpenDay,
  onSwipe,
}: {
  days: Date[];
  events: CalEvent[];
  now: Date;
  selectedKey: string | null;
  slot: { start: Date; end: Date; allDay?: boolean } | null;
  colorOf: (e: CalEvent) => string;
  badgesOf: (e: CalEvent) => string[];
  forecastOf: (e: CalEvent) => ForecastTag;
  onTapEvent: (e: CalEvent) => void;
  onTapSlot: (at: Date) => void;
  onCreateRange: (start: Date, end: Date) => void;
  onReschedule: (e: CalEvent, start: Date, end: Date) => void;
  onSlotChange: (start: Date, end: Date) => void;
  onOpenDay: (d: Date) => void;
  onSwipe: (dir: 1 | -1) => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Zoom: how many hours fill the card. Pinch (or ctrl + wheel / trackpad pinch) changes it, from the
  // whole day down to a few hours, and this device remembers it.
  const [viewH, setViewH] = useState(0);
  const [visibleHours, setVisibleHours] = useState(VISIBLE_HOURS);
  const hourH = viewH ? viewH / visibleHours : 56;
  const zoomRef = useRef({ hours: visibleHours, hourH });
  useEffect(() => {
    zoomRef.current = { hours: visibleHours, hourH };
  }, [visibleHours, hourH]);
  // The time to hold still while the zoom changes: `min` stays `y` px below the scroller's top.
  const zoomAnchor = useRef<{ min: number; y: number } | null>(null);
  const pinch = useRef<{ span: number; hours: number; min: number } | null>(null);
  const pinched = useRef(false); // this touch gesture became a pinch: no swipe, tap or drag
  const swipe = useRef<{ x: number; y: number; id: number; horizontal: boolean } | null>(null);
  const suppressClick = useRef(0);
  const dayView = days.length === 1;

  // Dragging events and empty space, as in Google Calendar (mouse) and iOS Calendar (touch):
  // - mouse: drag an event's edge to resize, its middle to move; drag empty space to create.
  // - touch: hold an event, then drag to move, or let go and drag its handles; hold empty space, then drag.
  const [adjustId, setAdjustId] = useState<string | null>(null); // touch: event showing its handles
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const press = useRef<Press | null>(null);
  const swallowClick = useRef(false); // the click that ends a hold or a drag
  const dragged = useRef(false); // this gesture was a drag, not a swipe
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setViewH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const saved = Number(store.get(ZOOM_KEY, VISIBLE_HOURS));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    if (saved >= MIN_HOURS && saved <= 24) setVisibleHours(saved);
  }, []);

  // Paging: on touch the week follows the finger, slides out when the swipe commits, and the next one
  // slides in from the other side. The arrows, Today and tapping a date get the same slide in.
  const pages = () => [
    ...(card.current?.querySelectorAll<HTMLElement>(
      ":scope > .cal-head, :scope > .allday, :scope > .cal-scroll",
    ) ?? []),
  ];
  const follow = (dx: number) =>
    pages().forEach((el) => (el.style.transform = dx ? `translateX(${dx}px)` : ""));
  const settle = (from: number, to: number, ms: number) =>
    Promise.all(
      pages().map((el) => {
        el.style.transform = "";
        return el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], {
          duration: reducedMotion() ? 0 : ms,
          easing: "cubic-bezier(0.3, 0.7, 0.4, 1)",
          fill: "forwards",
        }).finished;
      }),
    ).catch(() => undefined);
  const shownPage = useRef({ first: days[0].getTime(), count: days.length });
  useLayoutEffect(() => {
    const prev = shownPage.current;
    const first = days[0].getTime();
    shownPage.current = { first, count: days.length };
    if (prev.first === first || prev.count !== days.length) return;
    slideIn(pages(), first > prev.first ? 1 : -1, (card.current?.clientWidth ?? 600) * 0.3);
  }, [days]);

  // Open with 7 AM at the top. When the zoom changes, the anchored time (the pinch's midpoint, or else
  // the top of the view) stays where it was.
  const placed = useRef(false);
  const shownHourH = useRef(hourH);
  useLayoutEffect(() => {
    const el = scroller.current;
    const prev = shownHourH.current;
    shownHourH.current = hourH;
    if (!el || !viewH) return;
    if (!placed.current) {
      placed.current = true;
      el.scrollTop = (OPEN_AT - GRID_START) * hourH;
      return;
    }
    if (prev === hourH) return;
    const a = zoomAnchor.current ?? { min: (el.scrollTop / prev) * 60, y: 0 };
    el.scrollTop = (a.min / 60) * hourH - a.y;
  }, [hourH, viewH]);

  // Drift back to 7 AM after 60 s without scrolling (the zoom stays).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => el.scrollTo({ top: (OPEN_AT - GRID_START) * zoomRef.current.hourH, behavior: "smooth" }),
        60_000,
      );
    };
    el.addEventListener("scroll", arm, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", arm);
    };
  }, []);

  useEffect(() => {
    const p = press;
    return () => {
      if (p.current?.timer) clearTimeout(p.current.timer);
    };
  }, []);

  const cancelPress = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
  };
  // A second finger turns the gesture into a pinch: drop any hold, drag or swipe in progress.
  const endGestures = () => {
    cancelPress();
    if (swipe.current?.horizontal) follow(0);
    swipe.current = null;
    if (dragRef.current) setDrag(null);
    swallowClick.current = true;
  };
  // Native touch listeners, because React's are passive and can't stop the browser:
  // - while dragging, the finger must not also scroll the grid (touch-action can't change mid-gesture);
  // - two fingers pinch the time axis: apart shows fewer hours, larger; together shows more, up to the
  //   whole day. The time between the fingers stays under them, so moving both also scrolls.
  // - ctrl + wheel (a trackpad pinch in Chrome) zooms around the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const zoomTo = (hours: number, min: number, y: number) => {
      zoomAnchor.current = { min, y };
      setVisibleHours(clamp(hours, MIN_HOURS, 24));
    };
    const fingers = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      return {
        span: Math.max(40, Math.abs(a.clientY - b.clientY)),
        y: (a.clientY + b.clientY) / 2 - el.getBoundingClientRect().top,
      };
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length === 1) pinched.current = false;
      if (e.touches.length !== 2) return;
      const f = fingers(e);
      const { hours, hourH: h } = zoomRef.current;
      pinch.current = { span: f.span, hours, min: ((el.scrollTop + f.y) / h) * 60 };
      pinched.current = true;
      endGestures();
    };
    const move = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
      const p = pinch.current;
      if (!p || e.touches.length < 2) return;
      e.preventDefault();
      const f = fingers(e);
      zoomTo((p.hours * p.span) / f.span, p.min, f.y);
    };
    const end = (e: TouchEvent) => {
      if (!pinch.current || e.touches.length >= 2) return;
      pinch.current = null;
      zoomAnchor.current = null;
      store.set(ZOOM_KEY, zoomRef.current.hours);
    };
    let saveTimer: ReturnType<typeof setTimeout>;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const y = e.clientY - el.getBoundingClientRect().top;
      const { hours, hourH: h } = zoomRef.current;
      zoomTo(hours * Math.exp(e.deltaY * 0.01), ((el.scrollTop + y) / h) * 60, y);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        zoomAnchor.current = null;
        store.set(ZOOM_KEY, zoomRef.current.hours);
      }, 300);
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      clearTimeout(saveTimer);
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("wheel", wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the latest state through refs
  }, []);

  const startPress = (e: React.PointerEvent, begin: Press["begin"]) => {
    cancelPress();
    const touch = e.pointerType !== "mouse";
    const p: Press = {
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      slop: touch ? 10 : 4,
      timer: null,
      begin,
    };
    if (touch) {
      p.timer = setTimeout(() => {
        press.current = null;
        swallowClick.current = true;
        begin(p.y);
      }, HOLD_MS);
    }
    press.current = p;
  };

  const columns = () => [...(scroller.current?.querySelectorAll<HTMLElement>(".day-col") ?? [])];
  const columnFor = (day: Date) => columns()[days.findIndex((d) => ymd(d) === ymd(day))];
  const columnIndexAt = (clientX: number) => {
    const cols = columns();
    const i = cols.findIndex((c) => clientX < c.getBoundingClientRect().right);
    return i === -1 ? cols.length - 1 : i;
  };
  const minuteAt = (col: HTMLElement | undefined, clientY: number) =>
    col ? GRID_START * 60 + ((clientY - col.getBoundingClientRect().top) / hourH) * 60 : GRID_START * 60;

  // Every drag captures the pointer on the card, which stays mounted while events re-render beneath it.
  const beginDrag = (d: Omit<Drag, "moved">) => {
    try {
      card.current?.setPointerCapture(d.pointerId);
    } catch {
      // pointer already gone
    }
    dragged.current = true;
    swipe.current = null;
    setDrag({ ...d, moved: false });
  };
  const beginCreate = (day: Date, clientY: number, pointerId: number) => {
    const m = clamp(
      Math.floor(minuteAt(columnFor(day), clientY) / SNAP) * SNAP,
      GRID_START * 60,
      GRID_END * 60 - 30,
    );
    setAdjustId(null);
    beginDrag({ kind: "create", pointerId, day, event: null, anchorMin: m, startMin: m, endMin: m + 30 });
  };
  const beginEventDrag = (
    kind: "start" | "end" | "move",
    p: TimedPlacement,
    day: Date,
    pointerId: number,
    clientY: number,
  ) =>
    beginDrag({
      kind,
      pointerId,
      day,
      event: p.event,
      anchorMin: minuteAt(columnFor(day), clientY) - p.startMin,
      startMin: p.startMin,
      endMin: p.endMin,
    });

  const onPointerDownCapture = () => {
    swallowClick.current = false;
    dragged.current = false;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pinched.current) return;
    const p = press.current;
    if (p && p.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > p.slop) {
      if (p.timer)
        cancelPress(); // touch moved during the hold: it's a scroll or a swipe
      else {
        press.current = null;
        p.begin(p.y);
      }
    }
    const s = swipe.current;
    if (s && s.id === e.pointerId && e.pointerType !== "mouse" && !dragRef.current && !dragged.current) {
      const dx = e.clientX - s.x;
      if (
        !s.horizontal &&
        Math.abs(dx) > 12 &&
        Math.abs(e.clientY - s.y) < Math.abs(dx) * Math.tan(Math.PI / 6)
      )
        s.horizontal = true;
      if (s.horizontal) follow(dx);
    }
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.kind === "move") {
      const i = columnIndexAt(e.clientX);
      const length = d.endMin - d.startMin;
      const s = clamp(
        snapTo(minuteAt(columns()[i], e.clientY) - d.anchorMin),
        GRID_START * 60,
        GRID_END * 60 - length,
      );
      if (s !== d.startMin || ymd(days[i]) !== ymd(d.day)) {
        setDrag({ ...d, day: days[i], startMin: s, endMin: s + length, moved: true });
      }
      return;
    }
    const m = clamp(snapTo(minuteAt(columnFor(d.day), e.clientY)), GRID_START * 60, GRID_END * 60);
    if (d.kind === "end") setDrag({ ...d, endMin: Math.max(m, d.startMin + SNAP), moved: true });
    else if (d.kind === "start") setDrag({ ...d, startMin: Math.min(m, d.endMin - SNAP), moved: true });
    else
      setDrag({
        ...d,
        startMin: Math.min(d.anchorMin, m),
        endMin: m > d.anchorMin ? Math.max(m, d.anchorMin + SNAP) : d.anchorMin + 30,
        moved: true,
      });
  };
  const finishDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setDrag(null);
    swallowClick.current = true;
    const start = atMin(d.day, d.startMin);
    const end = atMin(d.day, d.endMin);
    if (d.kind === "create") onCreateRange(start, end);
    else if (!d.event) {
      if (d.moved) onSlotChange(start, end); // stretched the new-event highlight
    } else if (
      d.event &&
      d.moved &&
      (start.getTime() !== eventStart(d.event).getTime() || end.getTime() !== eventEnd(d.event).getTime())
    ) {
      onReschedule(d.event, start, end);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    cancelPress();
    if (pinched.current) {
      swipe.current = null;
      return;
    }
    finishDrag(e);
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId || dragged.current) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    // ≥ 60 pt horizontal travel at < 30° from horizontal (product spec → Touch rules)
    if (Math.abs(dx) >= 60 && Math.abs(dy) < Math.abs(dx) * Math.tan(Math.PI / 6)) {
      suppressClick.current = e.timeStamp;
      const dir = dx < 0 ? 1 : -1;
      if (s.horizontal) {
        const width = card.current?.clientWidth ?? 600;
        void settle(dx, -dir * width, 180).then(() => onSwipe(dir));
      } else onSwipe(dir);
    } else if (s.horizontal) void settle(dx, 0, 220);
  };
  const onPointerCancel = () => {
    if (swipe.current?.horizontal) follow(0);
    swipe.current = null;
    cancelPress();
    setDrag(null);
  };

  // The click that ends a swipe, a hold or a drag must not also open an event or a new-event panel.
  // A tap while handles are showing just puts them away.
  const clickAllowed = (e: React.MouseEvent) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return false;
    }
    if (e.timeStamp - suppressClick.current <= 400) return false;
    if (adjustId) {
      setAdjustId(null);
      return false;
    }
    return true;
  };

  const minToY = (min: number) => ((min - GRID_START * 60) / 60) * hourH;
  const todayKey = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // While resizing, lay the grid out with the new times so neighbours reflow live. (A move instead
  // leaves the event in place, faded, and draws a ghost where it will land.)
  const resizing = drag?.event && (drag.kind === "start" || drag.kind === "end") ? drag : null;
  const moving = drag?.kind === "move" && drag.moved ? drag : null;
  const shown = resizing
    ? events.map((e) =>
        e.key === resizing.event!.key
          ? {
              ...e,
              start: atMin(resizing.day, resizing.startMin).toISOString(),
              end: atMin(resizing.day, resizing.endMin).toISOString(),
            }
          : e,
      )
    : events;
  const allDay = layoutAllDay(shown, days[0], days.length);
  const allDayRows = Math.max(
    1,
    Math.min(
      2,
      allDay.bars.reduce((m, b) => Math.max(m, b.row + 1), 0),
    ),
  );
  const hasHidden = allDay.hiddenPerDay.some(Boolean);
  // A new all-day event is highlighted in the all-day row, across the days it covers that are on screen.
  const allDaySlot = (() => {
    if (!slot?.allDay) return null;
    const first = startOfDay(days[0]).getTime();
    const index = (t: number) => Math.round((startOfDay(new Date(t)).getTime() - first) / 86_400_000);
    const from = Math.max(0, index(slot.start.getTime()));
    const to = Math.min(days.length - 1, index(slot.end.getTime() - 1));
    return from <= to ? { from, to } : null;
  })();
  const cols = `64px repeat(${days.length}, minmax(0, 1fr))`;
  const range = (day: Date, from: number, to: number) =>
    `${fmtTimeShort(atMin(day, from))} – ${fmtTimeShort(atMin(day, to))}`;

  return (
    <div
      ref={card}
      className={`cal-card${dayView ? " is-day" : ""}${drag ? ` is-dragging is-${drag.kind}` : ""}`}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="cal-head" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => {
          const isToday = ymd(d) === todayKey;
          return (
            <button
              key={ymd(d)}
              className={`day-head${isToday ? " is-today" : ""}`}
              onClick={(e) => clickAllowed(e) && onOpenDay(d)}
              aria-label={`Open ${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`}
            >
              <span className="day-head-name">
                {d.toLocaleDateString("en-US", { weekday: dayView ? "long" : "short" })}
              </span>
              <span className="day-head-num">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div
        className="allday"
        style={{
          gridTemplateColumns: cols,
          gridTemplateRows: `repeat(${allDayRows + (hasHidden ? 1 : 0)}, 30px)`,
        }}
      >
        <div className="allday-label" style={{ gridRow: `1 / span ${allDayRows + (hasHidden ? 1 : 0)}` }}>
          all-day
        </div>
        {allDay.bars.map((b) => (
          <button
            key={b.event.key}
            className={`allday-bar${b.event.key === selectedKey ? " is-selected" : ""}`}
            style={{
              gridColumn: `${b.fromCol + 2} / ${b.toCol + 3}`,
              gridRow: b.row + 1,
              background: colorOf(b.event),
            }}
            onClick={(e) => clickAllowed(e) && onTapEvent(b.event)}
          >
            <span className="ev-title">{b.event.title}</span>
            <Badges list={badgesOf(b.event)} />
          </button>
        ))}
        {allDaySlot && (
          <div
            className="allday-slot"
            style={{ gridColumn: `${allDaySlot.from + 2} / ${allDaySlot.to + 3}`, gridRow: "1 / -1" }}
            aria-hidden
          />
        )}
        {allDay.hiddenPerDay.map((n, i) =>
          n ? (
            <button
              key={`more-${i}`}
              className="more-chip"
              style={{ gridColumn: i + 2, gridRow: allDayRows + 1 }}
              onClick={() => onOpenDay(addDays(days[0], i))}
            >
              +{n}
            </button>
          ) : null,
        )}
      </div>

      <div className="cal-scroll" ref={scroller}>
        <div
          className="cal-body"
          style={{ gridTemplateColumns: cols, height: (GRID_END - GRID_START) * hourH }}
        >
          <div className="hour-gutter">
            {Array.from({ length: GRID_END - GRID_START + 1 }, (_, i) => GRID_START + i).map((h) =>
              h % (hourH >= 64 ? 1 : 2) === 0 && h > GRID_START && h < GRID_END ? (
                <span key={h} className="hour-label" style={{ top: (h - GRID_START) * hourH }}>
                  {fmtHour(h)}
                </span>
              ) : null,
            )}
          </div>
          {days.map((d) => {
            const key = ymd(d);
            const { placements, overflow } = layoutDay(shown, d);
            const isToday = key === todayKey;
            const creating = drag?.kind === "create" && ymd(drag.day) === key ? drag : null;
            const landing = moving && ymd(moving.day) === key ? moving : null;
            // The new-event highlight can be stretched by its handles, like Google's draft block.
            const slotDrag = drag && !drag.event && drag.kind !== "create" ? drag : null;
            const slotHere = slot && !slot.allDay && !creating && ymd(slot.start) === key ? slot : null;
            const slotStart = slotDrag
              ? slotDrag.startMin
              : slotHere
                ? slotHere.start.getHours() * 60 + slotHere.start.getMinutes()
                : 0;
            const slotEnd = slotDrag
              ? slotDrag.endMin
              : slotHere
                ? slotStart + (slotHere.end.getTime() - slotHere.start.getTime()) / 60_000
                : 0;
            const slotHandle = (kind: "start" | "end") => (
              <div
                className={`ev-handle is-${kind}`}
                style={{
                  top: minToY(kind === "start" ? slotStart : slotEnd) - HIT / 2,
                  left: 2,
                  width: "calc(100% - 4px)",
                }}
                aria-hidden
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  beginDrag({
                    kind,
                    pointerId: e.pointerId,
                    day: d,
                    event: null,
                    anchorMin: 0,
                    startMin: slotStart,
                    endMin: slotEnd,
                  });
                }}
              >
                <span className="ev-handle-dot" />
              </div>
            );
            return (
              <div
                key={key}
                className={`day-col${isToday ? " is-today" : ""}`}
                style={{ backgroundSize: `100% ${hourH}px` }}
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget || adjustId || e.button !== 0) return;
                  const id = e.pointerId;
                  startPress(e, (y) => beginCreate(d, y, id));
                }}
                onClick={(e) => {
                  if (e.target !== e.currentTarget || !clickAllowed(e)) return;
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const min = Math.floor((GRID_START * 60 + (y / hourH) * 60) / 30) * 30;
                  const at = startOfDay(d);
                  at.setMinutes(Math.min(min, GRID_END * 60 - 30));
                  onTapSlot(at);
                }}
              >
                {slotHere && (
                  <>
                    <div
                      className="slot-highlight is-draft"
                      style={{
                        top: minToY(slotStart),
                        height: Math.max(hourH / 4, minToY(slotEnd) - minToY(slotStart)),
                      }}
                    >
                      <span className="drag-time">{range(d, slotStart, slotEnd)}</span>
                    </div>
                    {slotHandle("start")}
                    {slotHandle("end")}
                  </>
                )}
                {creating && (
                  <div
                    className="slot-highlight is-creating"
                    style={{
                      top: minToY(creating.startMin),
                      height: minToY(creating.endMin) - minToY(creating.startMin),
                    }}
                  >
                    <span className="drag-time">{range(d, creating.startMin, creating.endMin)}</span>
                  </div>
                )}
                {placements.map((p) => {
                  const startMin = Math.max(p.startMin, GRID_START * 60);
                  const endMin = Math.min(Math.max(p.endMin, startMin), GRID_END * 60);
                  const top = minToY(Math.min(startMin, GRID_END * 60 - 15));
                  const trueH = Math.max(MIN_EVENT, minToY(endMin) - minToY(startMin) - 2);
                  const hitH = Math.max(HIT, trueH);
                  const tag = forecastOf(p.event);
                  const compact = trueH < 30; // room for a title line and the time below it
                  const canDrag = draggable(p.event);
                  const adjusting = canDrag && idOf(p.event) === adjustId && !moving;
                  const isResizing = resizing?.event?.key === p.event.key;
                  const lifted = drag?.kind === "move" && drag.event?.key === p.event.key;
                  const left = `calc(${(p.col / p.cols) * 100}% + 2px)`;
                  const width = `calc(${100 / p.cols}% - 4px)`;
                  const handle = (kind: "start" | "end") => (
                    <div
                      className={`ev-handle is-${kind}`}
                      style={{ top: (kind === "start" ? top : top + trueH) - HIT / 2, left, width }}
                      aria-hidden
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        beginEventDrag(kind, p, d, e.pointerId, e.clientY);
                      }}
                    >
                      <span className="ev-handle-dot" />
                    </div>
                  );
                  return (
                    <Fragment key={p.event.key}>
                      <button
                        className={`ev-hit${canDrag ? " is-draggable" : ""}`}
                        style={{ top: top - (hitH - trueH) / 2, height: hitH, left, width }}
                        onPointerDown={(e) => {
                          if (!canDrag || e.button !== 0) return;
                          const id = e.pointerId;
                          if (e.pointerType === "mouse") {
                            const box = (
                              e.currentTarget.firstElementChild as HTMLElement
                            ).getBoundingClientRect();
                            const edge =
                              e.clientY - box.top <= EDGE
                                ? "start"
                                : box.bottom - e.clientY <= EDGE
                                  ? "end"
                                  : null;
                            if (edge) {
                              e.preventDefault();
                              beginEventDrag(edge, p, d, id, e.clientY);
                            } else {
                              startPress(e, (y) => beginEventDrag("move", p, d, id, y));
                            }
                            return;
                          }
                          const eventId = idOf(p.event);
                          startPress(e, (y) => {
                            setAdjustId(eventId);
                            beginEventDrag("move", p, d, id, y);
                          });
                        }}
                        onClick={(e) => {
                          if (adjusting && !swallowClick.current) {
                            // tapping the event that shows handles opens it, like any other tap
                            setAdjustId(null);
                            onTapEvent(p.event);
                            return;
                          }
                          if (clickAllowed(e)) onTapEvent(p.event);
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        aria-label={`${p.event.title}, ${fmtTimeShort(eventStart(p.event))}`}
                      >
                        <span
                          className={`ev${compact ? " is-compact" : ""}${p.event.key === selectedKey || adjusting ? " is-selected" : ""}${p.event.key.startsWith("temp:") ? " is-pending" : ""}${lifted && moving ? " is-lifted" : ""}`}
                          style={{ height: trueH, background: colorOf(p.event) }}
                        >
                          <span className="ev-title">{p.event.title}</span>
                          {isResizing ? (
                            <span className="ev-time">
                              {fmtTimeShort(eventStart(p.event))} – {fmtTimeShort(eventEnd(p.event))}
                            </span>
                          ) : (
                            !compact && <span className="ev-time">{fmtTimeShort(eventStart(p.event))}</span>
                          )}
                          {tag && !compact && !isResizing && (
                            <span className={`forecast-tag${tag.rain ? " is-rain" : ""}`}>{tag.text}</span>
                          )}
                          <Badges list={badgesOf(p.event)} />
                        </span>
                      </button>
                      {adjusting && (
                        <>
                          {handle("start")}
                          {handle("end")}
                        </>
                      )}
                    </Fragment>
                  );
                })}
                {landing?.event && (
                  <div
                    className="ev ev-ghost"
                    style={{
                      top: minToY(landing.startMin),
                      height: Math.max(MIN_EVENT, minToY(landing.endMin) - minToY(landing.startMin) - 2),
                      background: colorOf(landing.event),
                    }}
                    aria-hidden
                  >
                    <span className="ev-title">{landing.event.title}</span>
                    <span className="ev-time">{range(d, landing.startMin, landing.endMin)}</span>
                  </div>
                )}
                {overflow.map((o, i) => (
                  <button
                    key={`o${i}`}
                    className="more-chip more-chip-timed"
                    style={{ top: minToY(Math.max(o.startMin, GRID_START * 60)) }}
                    onClick={(e) => clickAllowed(e) && onOpenDay(d)}
                  >
                    +{o.count}
                  </button>
                ))}
                {isToday && nowMin >= GRID_START * 60 && nowMin <= GRID_END * 60 && (
                  <div className="now-line" style={{ top: minToY(nowMin) }} aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Badges({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <span className="ev-badges">
      {list.map((b) => (
        <span key={b} className="ev-badge">
          {b}
        </span>
      ))}
    </span>
  );
}
