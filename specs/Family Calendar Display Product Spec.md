# Family Calendar Display — Product Spec

Oct 26, 2026 · @Anderson

This file owns behaviour and requirements. Layout, visual tokens and on-screen details live in `visualdesign.md` (Option C: Ambient + Quick Edit); where the two disagree, `visualdesign.md` wins for anything visual and this file wins for anything functional.

Account names, URLs and locations below are placeholders (`<family-account>`, `<owner>`, `<ZIP>`). Real values are entered in Settings and stored server-side, never committed.

## Summary

A wall- or counter-mounted iPad Pro becomes the household's shared calendar: the family Google Calendar fills the right two-thirds of the screen and can be edited by touch, and the left third holds the time, weather, a month calendar and a slowly rotating photo mosaic from a curated SmugMug gallery. v1 targets iPad Pro 11" and 13" in landscape; iPhone 16 Pro is a later iteration.

**Problem.** The family calendar lives in the family Google account (`<family-account>@gmail.com`), but nobody looks at it unless they open a phone app. An always-on, glanceable, touchable display puts the week in front of everyone and makes adding an event as easy as tapping a time slot.

**Goals (v1)**

- Show calendars from several Google accounts, one account at a time or merged, glanceable from across the room (who is busy which day) and readable up close (titles and times).
- Add, edit and delete events by touch in under 15 seconds, without a keyboard or mouse.
- Show a photo mosaic from a configurable SmugMug gallery or folder, refreshed automatically.
- Show current weather, a short forecast for a configurable ZIP code, and the forecast on outdoor events.
- Run unattended for weeks: survives reloads, sleep and Wi-Fi drops without anyone re-logging in.

**Non-goals (v1)**

- iPhone layout (designed for, not built).
- Non-Google calendars (iCloud, Outlook).
- Uploading or editing photos; SmugMug stays the source of truth.
- Chores, meal plans, to-dos (candidate v2 widgets).

## Key decisions and pushback

**Decision: render the calendar ourselves from the Google Calendar API; do not iframe Google Calendar. (Confirmed 26 Oct 2026.)** The iframe plan cannot meet the touch-edit goal, for three reasons:

1. **The embeddable calendar is read-only.** Google's embed view (`calendar.google.com/calendar/embed`) displays events but has no create, edit or delete. Tapping an event only opens a link out to Google.
2. **The full Google Calendar app refuses to be framed.** Google sends frame-blocking headers on the main Calendar app and on its sign-in pages, so "log in inside an iframe" is not possible.
3. **Safari blocks the session the embed needs.** A private calendar embed only renders if the viewer is signed into Google in a third-party context. iPadOS Safari blocks third-party cookies by default, so a private embed shows a blank or sign-in state on the iPad.

What we do instead: sign in once with Google OAuth as the family account, keep a refresh token on the server, and draw our own touch-first week and day views from the Calendar API. We own the tap targets, the edit panel and the look, which is what makes the visual design achievable.

| Option | Touch edit | Matches visual design | Effort | Verdict |
| --- | --- | --- | --- | --- |
| Iframe the embed view | No (read-only) | No (Google's chrome) | Low | Rejected |
| Embed for display + our own "Add/Edit" panel via API | Partial (can't tap embedded events) | No | Medium | Fallback only |
| Our own calendar UI on the Calendar API | Yes | Yes | Medium-high | **Chosen** |
| Google Calendar web app full-screen, no mosaic | Yes | No | None | Rejected (no photos) |

**Decision: layout is visualdesign.md Option C.** Info card (time, weather, month calendar) and photo mosaic in a left column of about a third of the width; week calendar on the right. Editing happens in a panel that covers the left column, so the week stays visible while editing. This replaces the earlier stacked-rows layout (calendar top two-thirds, photos bottom third) and the bottom-sheet editor.

**Decision: support several connected Google accounts, with a merged view.** The family account is the first; personal accounts are added the same way. The display can show one account or all of them merged.

The simpler alternative, steel-manned: share each personal calendar with the family account ("Make changes to events") and connect only that one account. It needs no extra code, one token, and no duplicate handling, and edits still land on the right calendar. It falls short when a calendar can't be shared (a work account whose admin blocks external sharing) or when someone doesn't want their whole calendar visible to the family account. v1 supports multiple accounts; sharing remains the recommended setup wherever it works, and the two can be mixed. See the open question on building single-account first.

**Decision: pull photos from a configurable SmugMug gallery or folder through the SmugMug API v2, server-side.** The photo source is a SmugMug URL (a gallery or a folder) set in Settings, for example `https://<owner>.smugmug.com/<folder>/<gallery>/n-<nodeId>`. The app only ever reads what that URL points to. If the gallery is Public or Unlisted, an API key is enough. If it must stay Private, the server holds a SmugMug OAuth 1.0a token for the owner's account. Either way, credentials never reach the iPad.

**Decision: sign in with Supabase Auth, the same pattern as our other Next.js + Supabase projects (pricingresearch, happy-pups).** Every page except the login screen and email-link routes requires a signed-in user. Sign-in is email and password through `@supabase/ssr`; a `proxy.ts` gate refreshes the session cookie on every request and redirects anyone without a session to `/login?next=<path>`. The server checks the user with `getUser()` (validated against the auth server), never `getSession()`. This replaces the custom "app session cookie" in earlier drafts.

Two differences from those projects, because famcal's Supabase project is shared with other apps:

1. **No public sign-up.** The shared project's `auth.users` also holds pricingresearch and whaleboat users, so having a Supabase account is not enough. famcal keeps its own allowlist (`famcal.members`); a signed-in user who isn't on it sees "This account doesn't have access to the family calendar" and nothing else. Accounts are added by invitation from Settings (FR-9), not by a sign-up form.
2. **Project-wide auth settings are shared.** Email templates, the Site URL and the redirect allowlist belong to the whole Supabase project. famcal adds its own URLs to the redirect allowlist and must not change settings the other apps rely on (for example, turning off sign-ups project-wide would break pricingresearch).

Signing in to famcal is separate from connecting Google (FR-1): the login says who may use the display; the Google connection is how the server reads and writes calendars.

**Decision: ship as a full-screen web app (PWA), not a native iPad app.** Added to the Home Screen it runs without Safari chrome; Guided Access locks the iPad to it. A native app buys nothing v1 needs and adds App Store friction.

**Decision: Open-Meteo for weather, called from the server.** It is free for non-commercial use, needs no API key or account, and covers current, hourly and 16-day forecasts. It takes latitude/longitude, not ZIP, so the ZIP is geocoded once when saved (FR-41). ZIP lookup uses Open-Meteo's geocoder (matching on `postcodes`), falling back to Zippopotam.us (free, no key). Forecast fallback, if ever needed: OpenWeatherMap, which needs a free API key. Severe-weather alerts from the US National Weather Service are a v2 candidate.

## Devices and layouts

v1 is landscape iPad Pro using the Option C layout in visualdesign.md; portrait iPad is supported but secondary; iPhone is designed for and deferred.

| Device | CSS viewport, landscape (pt) | Portrait (pt) | Layout | Phase |
| --- | --- | --- | --- | --- |
| iPad Pro 13" (M4) | 1376 × 1032 | 1032 × 1376 | Left column 468pt (info + mosaic), week view ≈ 111pt per day | v1 |
| iPad Pro 11" (M4) | 1210 × 834 | 834 × 1210 | Left column 411pt, week view ≈ 96pt per day | v1 |
| iPhone 16 Pro | 874 × 402 | 402 × 874 | Mobile: agenda list, photos as a header card | Future |

Viewport figures are approximate and get verified on device in the Phase 0 spike.

**Layout rules**

- The layout is fluid in CSS points; it is never designed at a fixed pixel size and scaled to the screen.
- Left column `clamp(400pt, 34vw, 480pt)`; the calendar takes the rest. Within the left column the info card keeps its height and the mosaic absorbs leftover space.
- One breakpoint system: `≥ 1024pt wide` = desktop layout; `< 600pt` = mobile layout (future); between = desktop layout with fewer columns.
- Respect safe-area insets; no content under the Home indicator.
- Viewing distance: from 2–3 m you can read the clock, today's date, and which days are busy for whom (calendar colours). Event titles (16pt) and times (14pt) are read at arm's length.
- Light and dark themes, following the device's system appearance setting.

**Views**

- **Week (default):** 7 day columns, all-day row on top, hour grid from 6:00 to 22:00 that opens on 7:00–21:00 and scrolls for the rest.
- **Day:** single column, larger type, for busy days and for "+N" overflow.
- **Edit panel:** covers the left column for create, edit and detail; closes after 60 s idle (FR-18).

## Functional requirements

**Authentication and setup**

- FR-7: Login screen at `/login`: email, password, **Sign in**, and "Forgot password?". No sign-up link. Wrong credentials show one message ("Email or password is incorrect") without saying which. After sign-in, go to the `next` path (same-origin paths only) or the calendar.
- FR-8: Every route except `/login`, `/auth/*` and static assets requires a session and membership in `famcal.members`; API routes answer 401 instead of redirecting. "Forgot password?" sends a Supabase reset email; its link lands on `/auth/confirm`, which signs the user in and sends them to the set-new-password screen (`/auth/reset`).
- FR-9: Members: Settings (PIN) lists members and invites a new one by email (Supabase invite; the link lands on `/auth/confirm`, then set-password). Removing a member deletes their `famcal.members` row; since every page and API request checks membership, they lose access on their next request, without touching their Supabase sessions or account, which other apps may use. The first member is added by hand during setup (seed SQL), since there is no one to invite them.
- FR-1: One-time setup screen, shown to a signed-in member until Google is connected: "Connect Google" runs OAuth for one account at a time (first the family account; "Add account" repeats it for others) with the `calendar.events` and `calendar.calendarlist.readonly` scopes.
- FR-2: One Google refresh token per connected account, stored server-side, encrypted; the iPad holds only its Supabase session cookies. The display signs in once and stays signed in: no re-login after reboot, reload or 30 days idle, because the proxy refreshes the session on every request and the display polls every 60 s (see Security for cookie rules). Sign out lives in Settings, behind the PIN.
- FR-3: "Connect SmugMug" stores either an API key (public/unlisted content) or an OAuth 1.0a token (private content). The photo source is then set by pasting a SmugMug URL (see Photo source configuration), with a browse picker as a convenience.
- FR-4: Settings behind a 4-digit PIN: which calendars to show and their colours, family members and their emails, photo source URL(s), weather ZIP code and units, outdoor keywords, rotation speed, night hours.
- FR-5: If a token is revoked or expires, the display keeps showing cached data and a quiet banner: "Reconnect Google".
- FR-6: After 5 wrong PIN entries, PIN entry locks for 5 minutes; the lockout doubles on each further run of failures. Attempts are counted on the server.

**Calendar**

- FR-10: Show events from the chosen calendars across all connected accounts, colour-coded per calendar (e.g. one per person). Calendar colours may not reuse the accent or rain colours (visualdesign.md).
- FR-11: Create: tap **+ Add** or an empty 30-minute slot → edit panel prefilled with that day and time (or the next half hour), 1 h default; title, day/start/end with duration chips, all-day toggle, calendar picker, outdoor toggle, notify toggle (FR-11a), and under "More": location, guests (FR-60), notes.
- FR-12: Edit: tap an event → edit panel prefilled. All fields from FR-11 are editable. Read-only events open in detail mode with no Save or Delete.
- FR-13: Delete: from the edit panel, no confirmation dialog. The event disappears at once and an Undo toast shows for 8 s; the API delete is sent when the toast expires. The pending delete is saved on the device, so if the app reloads during the window it is sent on next start (and the event stays hidden until then).
- FR-14: Recurring events: edit or delete "This event" or "All events" (v1), chosen in an inline row in the panel; "This and following" is v2.
- FR-15: Navigate: swipe left/right or tap ‹ › for previous/next week; "Today" button always visible; tapping a date in the month calendar jumps to that week.
- FR-16: Sync: poll every 60 s while visible, re-listing the visible range (week plus month grid) for each selected calendar, with no server-side event cache, so a change made on a phone appears on the iPad within about 70 s. (Incremental `syncToken`s need a stored copy of the events to apply changes to, which contradicts "no server-side cache"; a full list of a few weeks is cheap at family scale.) Push notifications via Calendar watch channels are v2.
- FR-17: Optimistic UI while online: edits appear instantly; on API failure the change rolls back with an error toast. While offline, creating, editing and deleting are disabled and the footer says "Offline · last synced …".
- FR-18: Unsaved drafts: when the panel closes after 60 s idle, the draft is kept for 10 minutes and offered as a "Resume draft" chip next to + Add.
- FR-19: Month calendar dots: fetch the visible month (≈ 6 weeks) of events for all selected calendars, in addition to the visible week, so each date can show up to 3 calendar dots.

**Multiple accounts and merged view**

- FR-50: Settings lists connected Google accounts (email, avatar, status) with Add and Remove. Remove revokes that account's token and drops its cached events.
- FR-51: Per account, choose which of its calendars to show and each calendar's colour.
- FR-52: An account switcher in the calendar header, shown only when 2+ accounts are connected: segmented control with "All" plus one chip per account (initials or avatar), 44 pt tall. Selection persists across reloads.
- FR-53: "All" is the merged view: events from every selected calendar on every account in one grid. Each event shows its calendar colour; a small account badge appears only when two accounts share a colour. Events marked private in Google (`visibility: private`) on any account other than the family account show as "Busy" with no title or details.
- FR-54: De-duplicate in the merged view: the same meeting invited to two accounts has the same `iCalUID`. The key is `iCalUID` plus the occurrence's original start time (`originalStartTime`, or `start` for single events), because every occurrence of a repeating event shares one `iCalUID`. Show it once, with both account badges, and edit it through the organiser's account when it is connected.
- FR-55: Create: the panel's calendar picker lists writable calendars from all accounts, grouped by account. Default = the account in the switcher, or the family calendar when "All" is selected.
- FR-56: Edit and delete always go through the account that owns the event; read-only calendars (e.g. subscribed holidays, or calendars shared with view-only access) show events without Edit or Delete.
- FR-57: Moving an event to another account's calendar (v2). v1 shows a hint: delete and re-create.
- FR-58: Failures are isolated per account: if one token is revoked, that account's events show from cache with its own "Reconnect" badge; other accounts keep syncing.

**Guests and invitations**

Typing email addresses on an iPad keyboard is the slowest part of any invite, so the guest picker leads with taps, not typing.

- FR-60: The edit panel has a Guests field under "More". Add guests three ways: tap a family chip (each family member's email, set once in Settings), pick from recent guests (people who appear on events in the connected calendars), or type any email address. Typed addresses that aren't family members or recent guests require the PIN, so a visitor at the display can't send email from the family account to arbitrary people.
- FR-61: Guests show as removable chips with their RSVP status (accepted, declined, maybe, awaiting). Removing a guest on an existing event cancels their invite.
- FR-62: When guests have been added or removed, an "Email invitations" switch appears in the panel (default on); Save uses it as `sendUpdates`. No extra prompt. The organiser is the account that owns the event's calendar, so invites come from that account (FR-56).
- FR-63: Guest permissions toggles, defaulting to Google's defaults: guests can invite others, guests can see the guest list, guests can modify the event (off).
- FR-64: Where a connected account is itself a guest (not the organiser), the panel shows Yes / No / Maybe to RSVP for that account, and editing is limited to what the organiser allows.
- FR-65: Contact search across the Google address book (People API) is v2: it adds another sensitive OAuth scope. v1 relies on family chips, recent guests and typed addresses.

**Photo mosaic**

- FR-20: Read photos only from the configured source URL(s); videos skipped.
- FR-21: Mosaic of 5 tiles in the left column (one full-width hero, two 1×2 tall, two 1×1; visualdesign.md), photos chosen to match each tile's aspect ratio.
- FR-22: Every 20 s (configurable) one tile cross-fades to a new photo; every 10 minutes all tiles are re-picked, still one tile at a time.
- FR-23: New photos added to the gallery appear within 1 hour without touching the iPad.
- FR-24: Tap a photo → full-screen view with caption and date taken; tap again or wait 30 s to return.
- FR-25: Images served at the size the tile needs (≈ 1–2× tile pixels), never originals.

**Photo source configuration**

The photo source is a SmugMug URL the owner pastes into Settings, not a hard-coded gallery. Changing it takes effect on the next refresh, with no redeploy.

- FR-26: Settings accepts one or more SmugMug URLs, e.g. `https://<owner>.smugmug.com/<folder>/<gallery>/n-<nodeId>`. Stored server-side per household.
- FR-27: Resolve each URL on save. If it carries an `n-` segment, the part after `n-` is the SmugMug node ID: look up that node directly. Otherwise resolve the path (`/<folder>/<gallery>`) against the account named in the subdomain (`<owner>`).
- FR-28: If the node is a gallery (album), use its photos. If it is a folder, include photos from all galleries beneath it; a toggle limits this to direct children only.
- FR-29: On save, show what resolved: node name, type (gallery or folder), gallery count and photo count. Reject the URL with a clear message if it doesn't resolve, belongs to another account, or needs OAuth the app doesn't have.
- FR-30: If a configured source later disappears or turns private, keep showing the cached photos and raise the "Reconnect" banner from FR-5.
- FR-31: Optional filters per source: newest N photos, or only photos with a given keyword (e.g. `display`), so curation can happen by tagging instead of moving photos.

**Weather**

Current weather sits in the info card, right of the clock (visualdesign.md), so it never competes with the calendar or mosaic for space.

- FR-40: Settings takes a 5-digit US ZIP code (no default; setup asks for it) and units (°F default, °C option).
- FR-41: On save, the server converts the ZIP to latitude/longitude once and stores it with a place name (e.g. "Springfield, IL"). Settings shows that name so a mistyped ZIP is obvious; an unknown ZIP is rejected.
- FR-42: Compact view in the info card: condition icon, current temperature, condition, today's high/low, and a one-line summary (e.g. "Tapering by 2 PM").
- FR-43: Tap the weather block → a forecast sheet with the hourly forecast for the next 12 hours and a 5-day daily forecast; tap outside or wait 30 s to close.
- FR-11a: Notify: a switch in the edit panel sets a Google Calendar pop-up reminder on the event, so phones and computers signed in to that calendar's Google account alert before it starts. New events default to on, 10 minutes before (choices 5 min, 10 min, 30 min, 1 h); all-day events offer the day before at 5 PM or 9 AM, since their start is midnight. Turning it off removes the event's reminders. Opening an event shows its earliest pop-up reminder, or the calendar's default when the event uses defaults; the reminder is only written back when the switch or lead time was changed, so reminders set in Google Calendar are not overwritten by unrelated edits. The wall display itself doesn't alert.
- FR-44: Outdoor events within the next 7 days show a forecast tag ("Rain 60% · 52°" or "Dry · 54°") from the hourly forecast at the event's start time, and the edit panel shows the same forecast as a callout. Tags are hidden on weeks beyond that range.
- FR-45: Refresh every 15 minutes, cached on the server; if the provider is unreachable, show the last reading with its age and grey it out after 2 hours.
- FR-46: Data attribution line in the forecast sheet, as the provider's licence requires.
- FR-47: An event is outdoor when its Outdoor switch is on. The switch is stored on the Google event as a private extended property (`extendedProperties.private.famcalOutdoor = "1"`), so it survives across devices and reloads. For events without the property, the switch defaults on when the title matches the outdoor keyword list (Settings) and off otherwise; that guess is shown but not written to Google until the event is saved.

## Touch interaction

Every action is a tap, a swipe or a panel; nothing needs hover, right-click, or precise dragging in v1.

| Gesture | Where | Result |
| --- | --- | --- |
| Tap | Empty time slot | Edit panel, new event prefilled |
| Tap | + Add | Edit panel, new event at the next half hour |
| Tap | Event | Edit panel (or detail mode for read-only events) |
| Swipe left / right, or tap ‹ › | Calendar | Next / previous week (or day) |
| Tap | "Today" | Jump to current week, scroll to now |
| Tap | Date in month calendar | Jump to that week |
| Tap | "+N" overflow chip | Day view for that day |
| Tap | Weather block | Forecast sheet |
| Tap | Photo tile | Full-screen photo |
| Tap | "Resume draft" | Reopen the unsaved draft |
| Long-press + drag | Event | Move or resize (v2) |
| Pinch | Hour grid | Zoom hour height (v2) |

**Rules**

- Minimum touch target 44 × 44 pt (Apple HIG). Short events are drawn at their true length (minimum 24pt) with a 44pt-tall hit area, so they stay tappable without overstating their length.
- The edit panel covers only the left column, so the week stays visible. Its Save button sits in the panel header, so the on-screen keyboard never hides it; the body scrolls the focused field above the keyboard.
- Text entry uses the iPadOS keyboard, which brings dictation for free; quick-pick chips for common durations (30 min, 1 h, 2 h, all day).
- Scroll inside the hour grid never triggers week-swipe: horizontal swipe needs ≥ 60 pt travel and < 30° angle.
- Disable Safari's double-tap zoom, text selection on chrome, and pull-to-refresh.
- Every destructive action is undoable for 8 s rather than confirmed with a dialog.

## Architecture

A thin Next.js server on the TypeScript / Supabase stack sits between the iPad and the external APIs; the iPad never holds a third-party token.

```
┌──────────────────────┐ HTTPS + Supabase session   ┌───────────────────────────┐
│ iPad Pro (PWA)       │ ─────────────────────────▶ │ Next.js app server        │
│ Guided Access        │                            │ proxy.ts auth gate,       │
│                      │                            │ API routes                │
│ Service worker cache │ ◀───────────────────────── │                           │
└──────────────────────┘     JSON, sized images     └─┬──────┬──────┬─────────┬─┘
                                                      │      │      │         │
                                         ┌────────────▼┐ ┌───▼────┐ ┌▼───────┐ ┌▼──────────┐
                                         │ Google      │ │SmugMug │ │Open-   │ │ Supabase  │
                                         │ Calendar v3 │ │API v2  │ │Meteo   │ │ tokens,   │
                                         │ (per acct)  │ │        │ │        │ │ settings, │
                                         └─────────────┘ └────────┘ └────────┘ │ caches,   │
                                                                               │ Auth,     │
                                                                               │ members   │
                                                                               └───────────┘
```

- **Auth:** Supabase Auth via `@supabase/ssr`, laid out as in pricingresearch: `lib/supabase/server.ts` and `client.ts` (publishable key, user's session), `lib/supabase/proxy.ts` called from `proxy.ts` (refresh the session, gate everything but `/login` and `/auth/*`), `app/login` (page and server actions), `app/auth/confirm/route.ts` (email links; `next` restricted to same-origin paths). After the session check, the server confirms membership in `famcal.members`, then reads `famcal` data over a direct Postgres connection (`DATABASE_URL`, session pooler; the transaction pooler hung pooled connections in testing). supabase-js can't be used for this: it goes through the Data API, and the schema is deliberately not exposed there. The secret key is used only for Auth admin calls (invites).
- **Client:** Next.js PWA, installed to the Home Screen, locked with Guided Access. Calendar grid is custom (or a headless library such as FullCalendar restyled to visualdesign.md).
- **Server:** API routes proxy Open-Meteo (forecast), Google Calendar (list with sync tokens, insert, patch, delete events) and SmugMug (gallery images, sized URLs).
- **Caching:** serverless functions don't keep memory between requests, so shared caches live in Supabase (or HTTP cache headers): photo list for 1 hour, weather for 15 minutes, per-calendar `syncToken`s. Events are not cached on the server (FR-16).
- **Database location:** a dedicated `famcal` schema in a Supabase project shared with other apps. All famcal tables, functions and migrations live in that schema and never touch `public` or any other app's schema. Row-level security is on for every table with no `anon` or `authenticated` policies, and the schema is not added to the exposed Data API schemas: only the Next.js server reads it, with server-side credentials.
- **Storage:** Supabase holds the encrypted Google refresh tokens, SmugMug credentials, settings (photo source URLs, weather ZIP and its resolved coordinates, family members, outdoor keywords), the PIN hash and attempt counter, and `famcal.members` (Supabase user id, email, added by, added at). Login accounts themselves live in the project's shared `auth.users`. One household row, with one row per connected Google account (email, encrypted refresh token, selected calendars, colours); no multi-tenant design in v1.
- **Future iPhone build** reuses the same API routes; only the layout layer changes.

## Non-functional, security and privacy

**Reliability (it's an appliance)**

- Runs 30 days unattended with no manual reload. A service worker caches the app shell, the font, the last 4 weeks of events and the current photo set, so a Wi-Fi drop shows stale data with a "last synced" stamp, not a blank screen.
- Keep the screen on with the Screen Wake Lock API during day hours and release it during night hours. Wake Lock in Home Screen web apps has been unreliable on some iPadOS versions, so the Phase 0 spike verifies it; the fallback is iPad Settings → Display → Auto-Lock: Never, plus Guided Access.
- Auto-reload once a night at 3:00 to clear memory leaks (after flushing any pending delete, FR-13).
- Hosting: if Supabase is on the free tier, note that inactive projects are paused after about a week; the display's regular reads keep it active, but confirm in the spike or use a paid plan.

**Performance**

- First paint < 2 s on Wi-Fi; event create/edit reflected on screen < 300 ms (optimistic), confirmed by Google < 2 s.
- Mosaic transitions at 60 fps using CSS opacity/transform only.

**Security and privacy**

- Google and SmugMug credentials live only on the server, encrypted at rest. The browser never sees a Google or SmugMug token.
- Request the narrowest scopes: `calendar.events` and `calendar.calendarlist.readonly`, SmugMug read-only.
- The Google Cloud OAuth app must be moved to "In production" status: in "Testing" status, refresh tokens expire after 7 days and the display would silently log out weekly. As a personal app it can stay unverified (it shows a warning once at sign-in). Google Workspace (work) accounts often block unverified apps, so connecting a work account may fail; sharing that calendar with the family account is the workaround.
- Supabase session cookies are set by the server (the proxy and server actions, through `@supabase/ssr`), `Secure` and `SameSite=Lax`, and refreshed on use. Safari caps cookies set from JavaScript at 7 days, so the session must never be stored or refreshed client-side only.
- Login is rate-limited by Supabase Auth; the login screen adds no extra hints about which emails exist.
- Anyone standing at the iPad can edit the family calendar; that is the point. Settings, reconnect and invitations to unknown addresses are PIN-protected (FR-4, FR-6, FR-60). Delete is undoable, and Google keeps deleted events in Trash for 30 days.
- Private events from personal accounts show as "Busy" (FR-53).
- Every page and API route is behind the login (FR-8); without a session you get the login screen, never calendar data. A signed-in user who isn't a famcal member gets the no-access screen.
- Photos are proxied or signed short-lived URLs; the gallery's privacy setting on SmugMug is respected.
- Real account names, gallery URLs and the home ZIP are never committed to the repository (it is public); they exist only in Settings.

## Phasing

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 0. Spike (1–2 evenings) | Login first: Supabase Auth login screen, `proxy.ts` gate, `/auth/confirm`, `famcal.members` with the first member seeded. Then, behind the login: Google OAuth + list/create/delete one event; SmugMug resolve one URL and list one gallery; Open-Meteo ZIP geocoding; PWA on the 13" iPad with Wake Lock | `/login` loads without a session; any other path redirects to `/login?next=…`; a non-member is refused; the iPad stays signed in and the Google token survives a reboot; one photo and one event render on device; screen stays on for 1 hour as a Home Screen app |
| 1. MVP (iPad) | Week/day views, edit panel, mosaic, weather and outdoor tags, settings + PIN (members, invite, sign out), forgot password, offline cache, dark theme | Acceptance criteria below pass on both iPad sizes |
| 2. Polish | Drag to move/resize, push sync via watch channels, "this and following" recurrence, contact search, night mode tuning | Two weeks of daily family use with no reload |
| 3. iPhone 16 Pro | Agenda layout, photo header card, same backend | Same create/edit flows pass on iPhone |

## Acceptance criteria (v1)

- [ ] Opening any famcal URL without a session shows the login screen; after signing in, you land on the page you asked for.
- [ ] A Supabase user from another app on the shared project who is not in `famcal.members` cannot see any calendar data or call any API route.
- [ ] "Forgot password?" sends a reset email, and its link sets a new password and signs you in.
- [ ] A member invited from Settings receives an email, sets a password, and can sign in; removing them signs them out.
- [ ] After setup, the iPad shows this week's family events with no login or Google sign-in prompt, including after a reboot and after 30 days.
- [ ] A family member adds "Soccer, Sat 9–10am" by touch in under 15 s, and it appears on a phone's Google Calendar within 60 s.
- [ ] An event created on a phone appears on the iPad within 2 minutes.
- [ ] Editing and deleting (with undo) work for single and recurring events; a delete survives a reload during the undo window.
- [ ] With the on-screen keyboard open, Save stays visible and the focused field is not covered.
- [ ] The mosaic shows only photos from the chosen gallery; a photo added on SmugMug appears within 1 hour.
- [ ] Layout matches visualdesign.md on iPad Pro 11" and 13" in landscape, with no clipped text, no targets under 44 pt, and all text at ≥ 4.5:1 contrast in both themes.
- [ ] Pulling Wi-Fi shows cached events, photos and the last weather reading with a "last synced" stamp and disables editing; reconnecting resumes sync and editing with no reload.
- [ ] Entering a ZIP in Settings shows the matching place name; the info card then shows current temperature, high/low and a summary, and tapping it opens the hourly and 5-day forecast.
- [ ] An outdoor event this week shows a forecast tag; turning its Outdoor switch off removes the tag on every device that runs the app.
- [ ] With two accounts connected, the switcher flips between each account and "All"; in "All", a meeting invited to both accounts appears once (including each occurrence of a repeating meeting), and an event created there lands on the calendar picked in the panel.
- [ ] Revoking one account's access leaves the other accounts syncing normally.
- [ ] Creating "Dinner at Grandma's" and tapping two family chips sends both people a Google invitation from the organising account; removing one guest later cancels just their invite.
- [ ] Typing an unknown guest address asks for the PIN.

## Open questions

- [ ] Build order: ship v1 with the family account only (personal calendars shared to it) and add multi-account (FR-50–58) as v1.1? It removes the switcher, de-duplication and per-account failure handling from the first build.
- [ ] Who gets a famcal login: parents only, or kids too? Does the iPad sign in as a shared "display" member or as a parent?
- [ ] The shared Supabase project's email templates (invite, reset) are generic or branded for another app; is that acceptable, or does famcal need its own project later?
- [ ] Which calendars on the family account should show (the primary only, or per-person calendars too)?
- [ ] Is the SmugMug display gallery OK as Unlisted, or must it be Private (decides API key vs OAuth)?
- [ ] Mounting: landscape only, or must portrait be first-class on the 11"?
- [ ] Should kids be able to delete events, or only add/edit (a per-action PIN)?
- [ ] Hosting: reuse the Next.js + Supabase stack (likely Vercel), or run on a home server?
- [ ] Which accounts will be connected besides the family account, and can any of them simply share their calendars with the family account instead?
- [ ] Should switching to a single account require the PIN, so one person's calendar isn't shown to the whole house by accident?

## API references

Every calendar and photo requirement maps to a documented endpoint; nothing depends on scraping or the Calendar iframe.

**Supabase Auth** (shared project; app pattern copied from pricingresearch)

| Spec requirement | What to use | Docs |
| --- | --- | --- |
| FR-7 sign in | `supabase.auth.signInWithPassword` in a server action | [Password auth](https://supabase.com/docs/guides/auth/passwords) |
| FR-8 session gate | `@supabase/ssr` `createServerClient` in `proxy.ts`; `auth.getUser()` | [Server-side auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs) |
| FR-8 forgot password | `auth.resetPasswordForEmail`, then `auth.verifyOtp` on `/auth/confirm`, then `auth.updateUser({ password })` | [Password auth](https://supabase.com/docs/guides/auth/passwords) |
| FR-9 invite, remove | `auth.admin.inviteUserByEmail` and `auth.admin.signOut` (server only, secret key) | [Auth admin API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail) |

**Google Calendar API v3** (base `https://www.googleapis.com/calendar/v3`)

| Spec requirement | Endpoint | Docs |
| --- | --- | --- |
| FR-1 sign-in, scopes | OAuth 2.0, scopes `https://www.googleapis.com/auth/calendar.events` (view and edit events on all calendars) and `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (list calendars) | [Calendar API auth and scopes](https://developers.google.com/calendar/api/auth) |
| FR-10 pick calendars | `GET /users/me/calendarList` | [API reference](https://developers.google.com/calendar/api/v3/reference) |
| FR-10, FR-16 show and sync events | `GET /calendars/{calendarId}/events` with `singleEvents=true`; then `syncToken` for incremental sync (a `410 Gone` means do a full sync again) | [API reference](https://developers.google.com/calendar/api/v3/reference), [Sync guide](https://developers.google.com/calendar/api/guides/sync) |
| FR-11 create | `POST /calendars/{calendarId}/events` | [API reference](https://developers.google.com/calendar/api/v3/reference) |
| FR-12 edit | `PATCH /calendars/{calendarId}/events/{eventId}` | [API reference](https://developers.google.com/calendar/api/v3/reference) |
| FR-13 delete | `DELETE /calendars/{calendarId}/events/{eventId}` | [API reference](https://developers.google.com/calendar/api/v3/reference) |
| FR-14 recurring | `GET /calendars/{calendarId}/events/{eventId}/instances`; "All events" patches the event named by `recurringEventId` | [API reference](https://developers.google.com/calendar/api/v3/reference) |
| FR-47 outdoor flag | `extendedProperties.private` on insert/patch | [Extended properties guide](https://developers.google.com/calendar/api/guides/extended-properties) |
| FR-16 push sync (v2) | `POST /calendars/{calendarId}/events/watch`; channels expire and must be renewed | [Push notifications guide](https://developers.google.com/calendar/api/guides/push) |

Multiple accounts (FR-50–58) reuse the same endpoints, each call made with that account's own token. De-duplication keys on `iCalUID` plus the occurrence's original start time (FR-54).

Guests (FR-60–64) use the same insert and patch calls: the event's `attendees` list holds guest emails and RSVP status; the `sendUpdates` parameter (`all` or `none`) controls whether Google emails invitations; and `guestsCanInviteOthers`, `guestsCanSeeOtherGuests` and `guestsCanModify` set guest permissions. RSVP for a connected account is a patch to that account's own entry in `attendees`.

**SmugMug API v2** (base `https://api.smugmug.com/api/v2`)

| Spec requirement | What to use | Docs |
| --- | --- | --- |
| FR-3, public or unlisted gallery | API key on every request, no OAuth | [API key tutorial](https://api.smugmug.com/api/v2/doc/tutorial/api-key.html) |
| FR-3, private gallery | OAuth 1.0a: request token → authorize → access token, then sign each call | [Authorization tutorial](https://api.smugmug.com/api/v2/doc/tutorial/authorization.html), [OAuth web sample](https://api.smugmug.com/api/v2/doc/tutorial/oauth/web.html) |
| FR-26–28 resolve source URL | Resolve the configured URL: node ID from the n- segment → node lookup → its album, or its child nodes for a folder | [API v2 docs](https://api.smugmug.com/api/v2/doc/index.html) |
| FR-20 list photos | Album → images | [API v2 docs](https://api.smugmug.com/api/v2/doc/index.html) |
| FR-25 sized images | Image → size details (pick the size nearest the tile) | [API v2 docs](https://api.smugmug.com/api/v2/doc/index.html) |

SmugMug's exact path names for albums, images and sizes are confirmed in the Phase 0 spike. Its OAuth endpoints live under `https://secure.smugmug.com/services/oauth/1.0a/` ([sample client](https://gist.github.com/chestone/9421310)).

**Weather: Open-Meteo** (base `https://api.open-meteo.com/v1`)

| Spec requirement | What to use | Docs |
| --- | --- | --- |
| FR-41 ZIP → coordinates | Geocode once on save; confirm Open-Meteo's geocoding handles US ZIPs in the spike, else use OpenWeatherMap's ZIP lookup | [Open-Meteo](https://open-meteo.com/) |
| FR-42–44 current, hourly, daily | `GET /forecast?latitude=…&longitude=…` with current, hourly and daily variables; no API key | [Open-Meteo](https://open-meteo.com/), [source and docs](https://github.com/open-meteo/open-meteo) |
| FR-46 attribution | Data licensed CC BY 4.0; credit Open-Meteo | [source and docs](https://github.com/open-meteo/open-meteo) |
| Fallback provider | Current weather and 5-day forecast by ZIP + country; free API key | [OpenWeatherMap API](https://openweathermap.org/api) |
