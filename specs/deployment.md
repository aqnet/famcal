# famcal — Deployment Spec (Google Cloud Run)

Status: **decided, executing phase A**. Values in `<angle brackets>` (project ID, URLs, keys) are kept
out of the repo because it is public.

## 1. Goal

Run famcal as a single always-reachable HTTPS service that the wall iPad and family phones open from a
Home Screen icon, with:

- no server to patch (managed container platform),
- secrets kept out of the image, the build logs and the repo,
- a repeatable deploy from `main` (first by hand, then automatic),
- cost close to zero for one household.

Out of scope: staging environments, multi-region, load testing. Supabase (Auth + the `famcal` schema)
stays where it is; only the Next.js app moves. Local development keeps working unchanged against the
same Supabase project.

## 2. Target architecture

```
iPad / phones ──HTTPS──▶ Cloud Run service "famcal"  (<region>, container: Next.js standalone, Node 22)
                              │  env: config + secrets from Secret Manager
                              ├──▶ Supabase Auth (HTTPS, publishable + secret key)
                              ├──▶ Supabase Postgres, famcal schema (session pooler :5432, TLS, IPv4)
                              ├──▶ Google OAuth + Calendar API
                              ├──▶ Open-Meteo / Zippopotam.us (weather, ZIP lookup)
                              └──▶ SmugMug API (photos; images load directly from SmugMug's CDN)
```

- **One Cloud Run service**, public ingress, "allow unauthenticated" at the Cloud Run layer. The app
  does its own sign-in (Supabase Auth + `famcal.members`), so IAM-protected Cloud Run would only add a
  second login the iPad can't do.
- **Image built in the cloud** (Cloud Build), pushed to **Artifact Registry**. The dev machine is
  ARM64; Cloud Run runs amd64, so local builds would need slow emulation.
- **Secrets in Secret Manager**, exposed to the service as environment variables, readable only by a
  dedicated runtime service account.
- **Database over the pooler only.** Supabase's direct database host is IPv6-only and Cloud Run has no
  IPv6 egress without a VPC; the session pooler is IPv4 and is what development already uses.

## 3. Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Project | The existing **famcal** Cloud project (holds the OAuth client, Calendar API enabled, billing on), pending the org-policy check in §9 step 1 | One project for the app and its Google sign-in; no credentials to copy between projects. Fallback: a personal project without an organisation. |
| Region | `us-west1` (Oregon), the same region as the owner's other Cloud Run app | Consistent with existing services, and it supports Cloud Run domain mapping for the planned custom domain (§8). Trade-off: Supabase runs in AWS `us-east-2` (Ohio), ~50–60 ms away, so a request making 2–4 sequential queries spends ~0.1–0.25 s on the round trips. Acceptable for a display that polls once a minute; `us-east4` would be the move if it ever feels slow. |
| Time zone | `TZ=America/Los_Angeles` on the service (Pacific; the IANA name also handles daylight time) | Containers run in UTC; the dev machine runs in local time. Server rendering uses local-time date helpers (clock, date, month grid), so without `TZ` the first paint shows UTC and React logs hydration mismatches. |
| Instances | `min-instances=0`, `max-instances=2`, `concurrency=40` | The display polls every 60 s while visible, which keeps one instance warm all day; a cold start (~1–2 s) only after 15 idle minutes. Max 2 keeps the database pool bounded (2 × 3 connections) and caps cost. |
| CPU / memory | 1 vCPU, 512 MiB, request-based billing ("CPU only during requests"), startup CPU boost on | Next.js standalone idles at ~120 MB. Nothing runs after a response is sent (checked: no fire-and-forget server work), so throttled CPU between requests is safe. Boost shortens cold starts. |
| Timeout | 60 s | Longest request is a Google Calendar write plus refetch (< 5 s). |
| Database | Session pooler, port 5432 (unchanged) | The transaction pooler hung pooled connections in testing (see the product spec). |
| Build | `next build` with `output: "standalone"` in a multi-stage Dockerfile, `node:22-slim` base | Smallest image; no `node_modules` install at start. Debian slim over Alpine avoids musl surprises for little size cost. |
| Deploy tool | `gcloud builds submit` + `gcloud run deploy` (phase A), Cloud Build trigger on push to `main` (phase B) | Start manual to shake out config; automate once it works. |

## 4. Code and repo changes (before the first deploy)

1. **`next.config.ts`: `output: "standalone"`.** `next build` then emits `.next/standalone/server.js`
   with only the files it needs.
2. **Public origin from config, not the request.** Five places build absolute URLs from
   `request.nextUrl.origin` (Google OAuth redirect URI, its callback, `/auth/confirm`, the invite
   redirect, the Settings redirect). Behind Cloud Run's front end that can come out as the container's
   internal address (`http://0.0.0.0:8080`), which breaks the OAuth `redirect_uri` match. Add
   `APP_ORIGIN` (e.g. `https://<host>`) and a helper `appOrigin(request)` that prefers it and falls back
   to the request in development. Unit-test the helper.
3. **Version skew after a deploy.** The wall display keeps one page open for days; after a deploy its
   JavaScript is from the old build and Cloud Run no longer serves the old build's chunks. Expose the
   build's version from `/api/config` (already polled every 10 minutes) and reload the page when it
   differs from the version the page was built with (same rules as the 3 AM reload: not while a panel
   or an undo is open). Version = `package.json` version plus the commit SHA passed as a build arg.
4. **`Dockerfile`** (multi-stage, `node:22-slim`):
   - `deps`: `npm ci`.
   - `build`: copy source, `npm run build`. Build args: the two `NEXT_PUBLIC_*` values (Next inlines
     them into the browser bundle at build time; they are public by design — Supabase URL and
     publishable key) and `COMMIT_SHA` for the version.
   - `run`: copy `.next/standalone`, `.next/static`, `public`; run as the non-root `node` user;
     `ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080 NEXT_TELEMETRY_DISABLED=1`;
     `CMD ["node", "server.js"]`.
5. **`.dockerignore` and `.gcloudignore`**: `gcloud builds submit` uploads the directory using
   `.gcloudignore` (falling back to `.gitignore`), and Docker then filters with `.dockerignore`. Both
   list `node_modules`, `.next`, `.env*` (except `.env.example`), `.git`, `.claude`, `specs`, `coverage`.
   Secrets must never enter the upload or the build context.
6. **`cloudbuild.yaml`**: build with the build args, push to Artifact Registry tagged with the commit
   SHA (and `latest`), deploy that tag to Cloud Run. The `NEXT_PUBLIC_*` values come from Cloud Build
   **substitution variables** (`_SUPABASE_URL`, `_SUPABASE_PUBLISHABLE_KEY`) set on the trigger or the
   `gcloud builds submit` command, not hard-coded in the committed file, so the repo doesn't name the
   Supabase project.
7. **Health**: rely on Cloud Run's default TCP startup probe. No `/api/health` route unless startup
   problems appear.
8. **README**: a short "Deploy" section pointing here.

No change is needed for: cookies (`secure` already keys off `NODE_ENV=production`), the service worker
(production-only, needs HTTPS — Cloud Run provides it), or caches (weather, photos and events live in
Postgres; Google access tokens are per instance and refresh as needed).

## 5. Configuration

Plain environment variables (not secret):

| Name | Value |
| --- | --- |
| `APP_ORIGIN` | `https://<host>` (the run.app URL, or the custom domain) |
| `TZ` | the household's IANA time zone |
| `NEXT_PUBLIC_SUPABASE_URL` | build arg and env |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | build arg and env |
| `GOOGLE_CLIENT_ID` | env |

Secret Manager (one secret each, mounted as env vars, pinned to `latest`):

| Secret | Notes |
| --- | --- |
| `famcal-supabase-secret-key` | Auth admin only (invites). Use a key created for famcal, so it can be revoked on its own. |
| `famcal-database-url` | session pooler URL with the DB password |
| `famcal-encryption-key` | encrypts Google refresh tokens; **must be the same value as today**, or every connected Google account must reconnect |
| `famcal-google-client-secret` | |
| `famcal-smugmug-api-key` | |

Secrets are read when an instance starts, so a rotated secret takes effect on the next deploy (or
`gcloud run services update` to force a new revision). Create secret versions from files or stdin
(`gcloud secrets versions add … --data-file=-`), never as command-line arguments, so values don't land in
shell history.

`DEV_ORIGINS` is development-only and not set in Cloud Run.

## 6. External settings to update

1. **Google OAuth client** (Credentials → the famcal Web client): add authorised redirect URI
   `https://<host>/api/google/callback`. Keep the localhost one for development.
2. **Google Auth Platform → Audience**: publish to **In production**. In Testing, Google refresh tokens
   expire after 7 days and only listed test users can connect.
3. **Supabase → Authentication → URL Configuration**: add `https://<host>/auth/confirm` to Redirect URLs.
   Do not change the Site URL (shared with other apps).
4. **Google Cloud project**: enable `run.googleapis.com`, `cloudbuild.googleapis.com`,
   `artifactregistry.googleapis.com`, `secretmanager.googleapis.com`.

## 7. Identity and access

- **Runtime service account** `famcal-run@<project>.iam.gserviceaccount.com` with only
  `roles/secretmanager.secretAccessor` on the five famcal secrets. No other roles: the app talks to
  Supabase, Google APIs (with user OAuth tokens) and public APIs, not to other GCP services.
- **Build service account** (a dedicated `famcal-build@…`, not the default Compute account):
  `roles/run.developer`, `roles/iam.serviceAccountUser` on the runtime account,
  `roles/artifactregistry.writer`, `roles/logging.logWriter`.
- Deploys are done by the project owner's account until the trigger exists.

## 8. Domain

Decision: start on the **`*.run.app` URL**, move to a **custom domain** (`calendar.<owner's domain>`) once
it is registered.

- The `run.app` URL is free, HTTPS out of the box, and only typed once (Home Screen icon).
- The custom domain uses **Cloud Run domain mapping**, which `us-west1` supports (it is a preview
  feature and is not offered in every region). Steps when the domain exists: verify the domain in
  Search Console for the deploying account, `gcloud beta run domain-mappings create`, add the DNS
  records it prints, wait for the managed certificate. If domain mapping ever falls short, Firebase
  Hosting in front of the service is the free fallback; a global load balancer (~$18/month) is not
  worth it here.
- Do the switch before setting up the iPad for good, so the Home Screen icon is created once.

Changing the host later means updating `APP_ORIGIN`, the OAuth redirect URI and the Supabase redirect
URL, then re-adding the Home Screen icon (a Home Screen web app is tied to its origin, and its local
storage, such as the account filter, starts empty). Sign-ins and Google connections survive (they live
in the database).

## 9. Rollout plan

Phase A — first deploy (manual):

1. **Pre-flight checks** on the chosen project: billing enabled; no organisation policy blocking public
   services (`constraints/iam.allowedPolicyMemberDomains` must allow `allUsers` for the run.invoker
   binding, or the service can't be made public); the regional quota for Cloud Run is available.
2. Make the code changes in §4 on a branch; `npm run build` passes locally; the four checks
   (typecheck, lint, format, tests) pass.
3. Create the Artifact Registry repo (with a cleanup policy keeping the last 5 images), the secrets and
   the service accounts (§5, §7).
4. `gcloud builds submit --config cloudbuild.yaml --substitutions=…`; the first deploy prints the
   `run.app` URL.
5. Set `APP_ORIGIN` to that URL; update the Google OAuth redirect URI and the Supabase redirect URL
   (§6).
6. Smoke test on the deployed URL:
   - sign in; the display loads events, weather and photos; the clock shows local time on first paint
     (proves `TZ`) and the browser console shows no hydration errors;
   - Settings → PIN → Google "Add account" round trip works (proves the redirect URI);
   - create, drag-resize and delete a test event; check it in Google Calendar;
   - forgot-password email link lands on `/auth/confirm` and works;
   - the service worker registers (DevTools → Application) and the page survives going offline briefly;
   - deploy a trivial change and confirm an open page reloads itself within ~10 minutes (§4.3).
7. On the iPad: open the URL in Safari, Add to Home Screen, check wake lock, the 3 AM reload over a
   night, and the touch drag gestures (still untested on a real iPad).
8. Merge the branch.

Phase B — automatic deploys and monitoring:

9. Connect the GitHub repo to Cloud Build (2nd-gen repository connection) and add a trigger on push to
   `main` running `cloudbuild.yaml`, with the substitution variables set on the trigger.
10. A GitHub Actions check (lint, typecheck, tests, build) required before merge, so a broken `main`
    never deploys. Branch protection on `main` to require it.
11. A Cloud Monitoring uptime check on `https://<host>/login` every 5 minutes with an email alert
    (free). It catches a broken deploy or an expired secret before the family notices the wall.

Rollback: `gcloud run services update-traffic famcal --to-revisions=<previous>=100`. Every deploy keeps
its revision; there are no database migrations in a normal deploy, so rolling back the app is safe.
Schema changes stay manual, additive, and applied before the code that needs them.

## 10. Decisions log

| Question | Answer |
| --- | --- |
| Project | the existing famcal Cloud project |
| Domain | `run.app` first; custom domain `calendar.<owner's domain>` once registered |
| Region | `us-west1`, consistent with the owner's other Cloud Run app |
| Time zone | Pacific (`America/Los_Angeles`) |
| Phase B (automatic deploys, CI check, uptime alert) | yes, right after phase A |

## 11. Cost estimate (one household)

| Item | Estimate |
| --- | --- |
| Cloud Run | ~1 request/min from the display + occasional use ≈ 45k requests/month and a few vCPU-hours: inside the free tier ($0) |
| Cloud Build | a few builds a month: inside the free tier ($0) |
| Artifact Registry | ~150 MB per image, last 5 kept: at or under the free 0.5 GB ($0–0.10) |
| Secret Manager | 5 active secret versions ≈ $0.30; access calls inside the free tier |
| Cloud Monitoring | one uptime check: free |
| Egress | small JSON responses; photos load from SmugMug's CDN, not through Cloud Run: ~$0 |
| **Total** | **≈ $0.50/month** |

Set a **$5/month budget alert** on the billing account so a misconfiguration (for example
`min-instances` left at 1 with always-on CPU, ~$30+/month) is noticed quickly.

## 12. Risks

- **Origin detection** (§4.2) is the most likely first-deploy failure: an OAuth `redirect_uri_mismatch`
  or a sign-in redirect to the wrong host. `APP_ORIGIN` addresses it; the smoke test checks it.
- **Time zone** (§3): forgetting `TZ` shows a UTC clock for a moment on every load and logs hydration
  errors.
- **Encryption key drift**: deploying a different `FAMCAL_ENCRYPTION_KEY` than development makes stored
  Google tokens undecryptable (all accounts show "Reconnect"). Use the existing value.
- **Stale wall display after a deploy** (§4.3): without the version check, the iPad runs old code until
  3 AM and can fail to load parts of the app whose files the new build no longer has.
- **Database connections**: each instance opens up to 3 session-pooler connections, and development
  opens its own; the shared Supabase project has a pooler connection limit (check the plan's limit).
  `max-instances=2` keeps famcal's share at ≤ 6 in production.
- **Shared Supabase project**: the deploy touches no Supabase settings other than adding one redirect
  URL.
- **Organisation policy** (§9 step 1): the famcal project sits under an organisation; a domain-restricted
  sharing policy would block the public service. The pre-flight check finds this before any deploy work.
- **Public repo**: build args are the two public `NEXT_PUBLIC_*` values only, supplied at build time
  rather than committed; secrets never enter the image, the build logs or the repo.
