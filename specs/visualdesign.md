# Family Calendar Display — Visual Design (Option C: Ambient + Quick Edit)

This file owns layout, visual tokens and on-screen behaviour. Functional requirements (FR-n) live in `Family Calendar Display Product Spec.md`; where the two disagree, this file wins for anything visual and the product spec wins for anything functional.

## Concept
A wall/counter iPad Pro. On the left is an info card (time, weather, month calendar) above a SmugMug photo mosaic. On the right is the family week calendar, **drawn by the app from the Google Calendar API**, not embedded. Tap any event, an empty slot, or **+ Add**, and an edit panel slides over the left column, so the week stays visible while editing. Changes save straight to Google, so every family member's phone updates.

Why C over the embed options: the embed is view-only and the full Google Calendar app can't be framed. C is the only layout where you can edit in place, and where weather can be tied to individual events.

## Target screens
All sizes below are CSS points (pt = CSS px on iPad). The layout is fluid; nothing is designed at 1920×1080 and scaled down.

| Device | Landscape viewport | Left column | Day column | Hour height (7 AM–9 PM visible) |
|---|---|---|---|---|
| iPad Pro 13" (primary) | 1376 × 1032 | 468 | ≈ 111 | ≈ 58 |
| iPad Pro 11" | 1210 × 834 | 411 | ≈ 96 | ≈ 44 |

- Left column width: `clamp(400pt, 34vw, 480pt)`. The calendar takes the rest.
- Respect safe-area insets; nothing under the Home indicator.
- Portrait: stack the info card and mosaic above the calendar (not designed yet; v1 is landscape).

## Layout

```
┌──────────────────────┬──────────────────────────────────────────────────────┐
│ ┌──────────────────┐ │ October 2026  ‹ › Today   [All|AQ|FA]      [+ Add]   │
│ │ 10:42 AM   ☂ 54° │ │ ┌──────────────────────────────────────────────────┐ │
│ │ Mon, Oct 26  Rain│ │ │ all-day row                                      │ │
│ │          H57 L46 │ │ │ Sun  Mon  Tue  Wed  Thu  Fri  Sat                │ │
│ │──────────────────│ │ │ ▓▓   ▓▓        ▓▓   ▓▓        ▓▓   (tap = edit)  │ │
│ │ October 2026     │ │ │      ▓▓   ▓▓   ▓▓   ▓▓   ▓▓   ▓▓                 │ │
│ │ S M T W T F S    │ │ │ Soccer [Rain 60% · 52°]                          │ │
│ │ ·  ·  ·  ·  ·  · │ │ │                                                  │ │
│ └──────────────────┘ │ └──────────────────────────────────────────────────┘ │
│ ┌────────┬─────────┐ │ ● Mom ● Dad ● Kids ● Family        Synced 10:42 AM   │
│ │  hero  │         │ │                                                      │
│ ├────┬───┤  tall   │ │                                                      │
│ │    │   │         │ │                                                      │
│ └────┴───┴─────────┘ │                                                      │
│ SmugMug · [Gallery]  │                                                      │
└──────────────────────┴──────────────────────────────────────────────────────┘
  34% (400–480pt)                       remaining width
```

| Region | Size | Notes |
|---|---|---|
| Canvas | full viewport | Horizontal flex, page background `--bg` |
| Left column | `clamp(400pt, 34vw, 480pt)` | `padding: 24px 0 24px 24px`, vertical flex, `gap: 16px`, `position: relative` (anchors the edit panel) |
| Info card | content height (~420pt; ~380pt on 11") | `--surface`, 1px `--border`, 20px radius, 24px padding, `gap: 18px` |
| Photo mosaic | fills the rest (≈ 520pt on 13", ≈ 300pt on 11") | 2-col × 6-row grid, `gap: 4px`, 20px radius on the container (tiles are square-cornered inside) |
| Photo caption | ~20pt | "SmugMug · [Gallery name]" |
| Right panel | `flex: 1` | 32px padding, vertical flex, `gap: 16px` |
| Calendar header | ~56pt | Month and year, ‹ › arrows and **Today** on the left; account switcher (only when 2+ accounts) in the middle; **+ Add** on the right |
| Calendar card | fills the rest | `--surface`, 1px border, 20px radius; 64pt hour column + 7 day columns |
| Footer | ~24pt | Calendar legend on the left; "Synced 10:42 AM" (or "Offline · last synced …") on the right |

## Info card (left column, top)
A dedicated card. Nothing sits over the photos.

**Row 1: time and weather** (space-between)
- **Left:** time 72pt/800 (letter-spacing −2.5px); date below 20pt/600 `--text-2`.
- **Right, right-aligned:** condition icon 40pt plus temperature 44pt/800; condition 17pt/700; hi/lo 15pt `--text-2`; summary 15pt/600 in `--rain` when rain is involved (e.g. "Tapering by 2 PM").
- The whole weather block is a button: tap opens the forecast sheet (next 12 hours + 5 days), anchored to the info card, closes on outside tap or after 30 s.
- If weather is stale (> 2 h), the block turns `--text-3` and shows its age ("54° · 3 h ago").

**Row 2: month calendar** (above a hairline divider, 14pt top padding)
- Month and year 18pt/700; weekday letters 13pt/700 `--text-3`.
- 7-column date grid, 38pt rows (34pt on the 11"), 5 or 6 rows.
- Today: 28pt filled `--accent` circle with `--on-accent` text, 800 weight.
- The week shown on the right gets a `--week-band` band. Tapping a date jumps the week view there.
- Days outside the month: `--text-3` at weight 400 (in-month days are `--text` at 600).
- **Event dots:** up to 3 dots (5pt) under each date, one per calendar with events that day.

## Photo mosaic (left column, bottom)
Family photos are 3:2 (landscape) or 2:3 (portrait), so every tile is exactly one of those shapes. The mosaic is a stack of full-width bands, chosen to fit the space the device leaves (`lib/mosaic-layout.ts`):

| Band | Tiles |
|---|---|
| H | one full-width 3:2 hero |
| LL | two 3:2 side by side |
| PPP | three 2:3 side by side |
| PLL / LLP | a 2:3 beside two stacked 3:2 (either side) |

The stack (up to four bands; only LL may repeat, as a 2×2 grid) is the one closest to the space's shape, pulled toward about five tiles and toward the gallery's mix: no more portrait (or landscape) tiles than there are photos of that orientation, ideally half as many so rotation has spares. Any small difference is a light stretch shared by every tile. With a typical mix: 13" landscape LL + PLL, 11" landscape LL + PPP, 13" portrait H + PLL + H, 11" portrait H + PPP + H, each 5 tiles. A gallery with only a couple of portraits gets e.g. LL + LL on the 11".

- Tiles use `object-fit: cover`, centered, with a 4 px gap. Each tile gets a photo of its own orientation, so a photo fills its tile uncropped.
- Every 20 s (configurable) one tile flips over like a card to a new photo (~1.2 s, 3D turn with a slight overshoot; instant with Reduce Motion). Every 10 minutes every tile is re-picked, still flipping one at a time, never all at once.
- Once every tile has flipped to a new photo, the next tick changes the layout: the mosaic slides up and out as another layout slides up in from below (~0.9 s, a 4 px gap between them), with photos the old layout wasn't showing where possible. The next layout is a random different pick from the layouts nearly as good as the best for the space and the gallery's mix, none stretching its tiles more than ~12% (`layoutChoices`). With Reduce Motion it swaps instantly.
- Tap a tile: full-screen photo with caption and date taken; tap again or wait 30 s to return.
- While the edit panel is open the mosaic sits underneath it; at night it dims to 50% opacity.

## Week calendar (right panel)
- **Columns:** 64pt hour gutter plus 7 equal day columns. Day header is the weekday at 16pt/600 with the date number at 24pt/800. Today's column is tinted `--today-tint` and its header text is `--accent`.
- **Hours:** the grid spans 6 AM–10 PM and scrolls vertically; it opens showing 7 AM–9 PM, and drifts back to that window after 60 s idle. Hairline every hour, label every 2 hours (14pt `--text-3`). A 2pt `--accent` line marks the current time.
- **All-day row:** above the hour grid, up to 2 rows of bars; more shows a "+N" chip. Timed events longer than 24 h also draw here as bars.
- **Events:** `<button>`s placed by start and end time, filled with the calendar color, `--on-event` text, 8px radius. The selected event gets a 3px `--text` ring.
  - ≥ 40pt tall: title 16pt/600 plus start time 14pt/500.
  - < 40pt tall: title only, 14pt/600, single line.
  - Drawn at true length with a minimum of 24pt; the hit area extends to 44pt tall (centred, clipped by neighbours) so every event is tappable.
  - Events crossing midnight are split at midnight.
  - Private events from a non-family account (Google `visibility: private`) draw as "Busy" with no details.
- **Overlaps:** up to 3 events side by side, sharing the column width. A 4th or more collapses into a "+N" chip that opens the day view.
- **Empty slots:** tap an empty 30-minute slot to open the edit panel prefilled with that time.
- **Forecast tag:** outdoor events carry a `--surface` pill under the label, 13pt/700. `--rain` text when rain chance ≥ 40% ("Rain 60% · 52°"), `--text-2` otherwise ("Dry · 54°"). Only shown for events within the hourly forecast range (the next 7 days); hidden on later weeks.
- **Legend (footer):** colored 12pt dot plus calendar name, 16pt/600.
- **Navigation:** swipe left/right (≥ 60pt travel, < 30° angle) or tap ‹ › for previous/next week. **Today** returns to the current week.
- **Day view:** one column, same rules, larger labels (title 20pt/600).

## Edit panel (overlays the left column)
- **Placement:** `position: absolute; inset: 24px 0 24px 24px` inside the left column (it covers the info card and photos, never the calendar). `--surface`, 24px radius, soft shadow (the only shadow in the system).
- **Header (pinned, never scrolls):** Close icon button (48pt, `aria-label="Close"`) on the left, "New event" / "Edit event" 28pt/800, **Save** (48pt pill, filled `--accent`) on the right. Save lives in the header so the on-screen keyboard can never hide it.
- **Body:** scrolls independently; 24px padding. When a field gains focus it scrolls into the space above the keyboard. Fields are labeled inputs, 56pt tall, 12px radius.
  1. **What:** event name.
  2. **When:** Day / Start / End in three columns; quick chips below: 30 min, 1 h, 2 h, All day.
  3. **Calendar:** one pill per writable calendar (48pt tall), single choice; the selected one is filled with its calendar color. Grouped by account when more than one account is connected.
  4. **Outdoor:** switch, "Show forecast for this event". Pre-switched on when the title matches the outdoor keyword list; the user can turn it off.
  5. **More** (collapsed by default): Location, Guests, Notes, guest permissions.
  - **Guests:** family-member chips first (one tap), then recent guests, then a typed address. Guests show as removable chips with RSVP status. When guests have changed, an "Email invitations" switch appears above the Save area (default on).
- **Forecast callout** (outdoor events within forecast range): `--callout` box with condition icon and "Forecast at event time: …", 17pt/600 in `--callout-text`.
- **Repeating events:** on Save or Delete, an inline choice row appears in the panel: "This event" / "All events" (no browser dialog).
- **Delete:** at the bottom of the body (edit only), outlined `--danger` text button, 56pt. Deleting closes the panel and shows an 8 s **Undo** toast at the bottom of the calendar. No confirmation dialog.
- **Read-only events** (subscribed or view-only calendars): the panel opens in detail mode with no Save or Delete.
- **Guest-only events** (a connected account is invited, not organising): the panel shows Yes / No / Maybe RSVP buttons for that account and only the fields the organiser allows.

## Login screen (`/login`)
Shown to anyone without a session (product spec FR-7–9). On the display it is seen once, at setup; after that the iPad stays signed in.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                  ┌──────────────────────────┐                │
│                  │ Family Calendar          │                │
│                  │ Sign in to continue      │                │
│                  │                          │                │
│                  │ Email                    │                │
│                  │ [                      ] │                │
│                  │ Password                 │                │
│                  │ [                   👁 ] │                │
│                  │                          │                │
│                  │ [        Sign in       ] │                │
│                  │     Forgot password?     │                │
│                  └──────────────────────────┘                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

- **Page:** `--bg` background, no photos, clock or calendar data. Card centred horizontally and placed in the upper third, so the on-screen keyboard never covers the Sign in button.
- **Card:** 440pt wide (full width minus 32pt on narrow screens), `--surface`, 1px `--border`, 20px radius, 40px padding, `gap: 16px`.
- **Heading:** "Family Calendar" 30pt/800; "Sign in to continue" 17pt/600 `--text-2`.
- **Fields:** labeled inputs, 56pt tall, 12px radius, 18pt text. Email uses `type="email"`, `autocomplete="email"`, no auto-capitalisation; password uses `autocomplete="current-password"` (so iPadOS can offer saved passwords) and a 48pt show/hide button.
- **Sign in:** full-width, 60pt, filled `--accent`, 18pt/700. Shows a spinner and is disabled while signing in.
- **Forgot password?:** text button, 48pt tall, `--accent`. Switches the card to one email field and **Send reset link**; on send it shows "If that address has an account, a reset link is on its way."
- **Errors:** one line above the Sign in button in `--danger`, 15pt/600, e.g. "Email or password is incorrect." Fields keep their values except the password.
- **No sign-up link.** Members are invited from Settings.
- **Set new password** (`/auth/reset`, after an invite or reset link): same card, "Set a password", new password + confirm (min 8 characters), **Save password**.
- **No access** (signed in, not a famcal member): same card, "This account doesn't have access to the family calendar", the signed-in email, and **Sign out**.
- Follows the system light/dark setting like every other screen.

## Design tokens

### Color (light, default)
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#F7F6F2` | Page background (warm off-white) |
| `--surface` | `#FFFFFF` | Info card, calendar card, edit panel, forecast pills |
| `--border` | `#DCD9D2` | Card and input borders |
| `--hairline` | `#E7E5E0` | Grid lines, dividers |
| `--text` | `#1D1D1B` | Primary text |
| `--text-2` | `#55534E` | Date, hi/lo, captions |
| `--text-3` | `#6B6963` | Hour labels, weekday letters, hints, out-of-month days |
| `--accent` | `#1F5C5A` | + Add, Save, today marker, now line |
| `--on-accent` | `#FFFFFF` | Text on `--accent` |
| `--on-event` | `#FFFFFF` | Text on calendar colors |
| `--today-tint` | `#F2F7F6` | Today's column |
| `--week-band` | `#EAF2F1` | Current week in the month calendar |
| `--rain` | `#1F6FB2` | Rain icon, rain summary, rain tags |
| `--callout` | `#EEF4FA` | Forecast callout background |
| `--callout-text` | `#1D4F7E` | Forecast callout text |
| `--danger` | `#B3261E` | Delete button outline and text |

### Color (dark)
Used whenever the device's system appearance is Dark; there is no time-based switch. To keep the display dark at night, set the iPad to Dark appearance (or Automatic) in iPad Settings → Display & Brightness.

| Token | Hex |
|---|---|
| `--bg` | `#121211` |
| `--surface` | `#1E1E1C` |
| `--border` | `#3A3935` |
| `--hairline` | `#2B2A27` |
| `--text` | `#EDEBE6` |
| `--text-2` | `#BAB7AF` |
| `--text-3` | `#9C998F` |
| `--accent` | `#6FB3AE` |
| `--on-accent` | `#0F1F1E` |
| `--today-tint` | `#1A2524` |
| `--week-band` | `#22302F` |
| `--rain` | `#7DB4E6` |
| `--callout` | `#1A2633` |
| `--callout-text` | `#B9D6F2` |
| `--danger` | `#F2867E` |

Calendar colors keep their light values at night (white text on them stays above 4.5:1).

### Calendar colors
Default palette, assigned in Settings per calendar. No calendar color may reuse `--accent` (teal) or `--rain` (blue), so the today marker, Save button and rain tags never read as someone's events.

| Default for | Hex | White text contrast |
|---|---|---|
| Mom | `#A3366F` berry | 6.3:1 |
| Dad | `#4A5560` slate | 7.6:1 |
| Kids | `#B5501A` orange | 5.1:1 |
| Family | `#6B4FA0` purple | 6.3:1 |
| 5th+ calendars | `#2E7D32` green, `#8D6E00` ochre, `#5D4037` brown | ≥ 4.5:1 |

Weather icon strokes: sun `#C98A00`, cloud `--text-3`, rain `--rain`.

### Typography
Font: **Manrope** (Google Fonts, weights 400–800), self-hosted so it renders offline, with `system-ui` as fallback.

| Role | Size / weight |
|---|---|
| Clock | 72pt / 800, letter-spacing −2.5px |
| Temperature | 44pt / 800 |
| Month (calendar header) | 30pt / 800 |
| Edit panel title | 28pt / 800 |
| Day header | 16pt / 600, date number 24pt / 800 |
| Date (info card) | 20pt / 600 |
| Event title | 16pt / 600 (14pt when the event is < 40pt tall) |
| Event time | 14pt / 500 |
| Buttons | 17–20pt / 700 |
| Hour label | 14pt |
| Weekday letters (month calendar) | 13pt / 700 |
| Forecast tag | 13pt / 700 |

**Viewing distance.** From 2–3 m, people should be able to read the clock, today's date, and which days are busy and for whom (calendar colors). Event titles and times are for reading at arm's length (~1 m); they are not expected to read across the room.

### Shape and touch
- Radius: cards 20px, edit panel 24px, inputs 12px, events 8px, buttons and pills 999px.
- Touch targets ≥ 44pt: + Add 56pt, Save 48pt, Delete 56pt, calendar pills 48pt, close 48pt, ‹ › and Today 44pt. Events: 44pt hit area regardless of drawn height.
- No gradients. Only the edit panel has a shadow.
- Disable double-tap zoom, text selection on chrome, and pull-to-refresh.

## Interaction
| State | Left column | Calendar | Trigger |
|---|---|---|---|
| **Ambient** (default) | Info card plus photos | Week view | — |
| **Add** | Edit panel over the left column | Tapped slot highlighted | **+ Add** or tap an empty slot |
| **Edit** | Edit panel prefilled; forecast callout if outdoor | Selected event ringed | Tap an event |
| **Photo** | Full-screen photo | Hidden | Tap a tile |
| **Forecast** | Forecast sheet over the info card | Unchanged | Tap the weather block |

- **Save:** update the calendar immediately, then create or patch through the API; roll back with an error toast if it fails.
- **Delete:** remove immediately and show an 8 s Undo toast; the API delete is sent when the toast expires. See FR-13 for reloads during that window.
- **Idle timeout:** the panel closes after 60 s with no input. An unsaved draft is kept for 10 minutes and shown as a **Resume draft** chip next to + Add.
- **Offline:** a banner in the footer ("Offline · last synced 10:42 AM"); the week, photos and last weather stay visible; + Add, tap-to-create and Save are disabled until the connection returns.
- **Refresh:** clock every 30 s, events every 60 s, weather every 15 min, one photo tile every 20 s.

## Accessibility
- Events, pills and chips are real `<button>`s; fields are real `<input>`s with `<label>`s.
- Text contrast ≥ 4.5:1 for all text, in both themes, including white text on every calendar color.
- Color is never the only signal: the legend names each calendar, and the edit panel names the selected calendar.

## Platform notes
1. **Calendar API, not the embed.** The app reads and writes events with the Google Calendar API (`events.list`, `insert`, `patch`, `delete`). We fully control the look.
2. **Auth, weather, photos:** see the product spec (FR-1, FR-40–47, FR-20–31). Credentials stay on the server.

## Open items
- [SmugMug gallery name, and whether it's public, unlisted or private]
- Outdoor keyword list (starting set: soccer, park, hike, game, practice, beach, bike)
- Portrait layout, if portrait becomes first-class
