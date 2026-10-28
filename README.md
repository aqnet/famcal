# famcal

A family calendar for a wall- or counter-mounted iPad Pro: the family Google Calendar on the right (editable by
touch), and the time, weather, a month calendar and a SmugMug photo mosaic on the left.

Specs: [product](specs/Family%20Calendar%20Display%20Product%20Spec.md) · [visual design](specs/visualdesign.md)

## Stack

Next.js 16 (App Router, `proxy.ts`) · Supabase Auth via `@supabase/ssr` · Postgres (`famcal` schema in a shared
Supabase project, read by the server over a direct connection) · Google Calendar API v3 · SmugMug API v2 ·
Open-Meteo.

## Getting started

```bash
git clone https://github.com/aqnet/famcal.git
cd famcal
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

Setup checklist:

1. **Database**: apply `db/migrations/*.sql` in order (they only touch the `famcal` schema), then add the first
   member by hand:
   `insert into famcal.members (user_id, email) select id, email from auth.users where email = '<you>';`
2. **Supabase Auth**: add `<origin>/auth/confirm` to the project's redirect URLs (Authentication → URL
   Configuration). Don't change the Site URL or sign-up settings; other apps share them.
3. **Google**: create an OAuth client (Web application) with redirect URI `<origin>/api/google/callback`, enable the
   Google Calendar API, and set the consent screen to **In production** (in Testing, refresh tokens expire after 7
   days).
4. **SmugMug**: get an API key; galleries must be Public or Unlisted (private galleries need OAuth, not built yet).
5. Sign in, connect Google, then open Settings (gear icon) to choose a PIN, the weather ZIP and photo galleries.

## Scripts

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test` · `npm run format`
