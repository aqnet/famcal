# FamCal — Multi-tenant Spec

Oct 30, 2026 · @Anderson · Status: **draft, not started**

This file owns the move from one household to many. Everything in the product spec (`Family Calendar Display Product Spec.md`) still applies, now **per household**. Where the two disagree on accounts, households, sign-up or data separation, this file wins. Requirements here are numbered MT-n so they don't collide with the product spec's FR-n.

## Summary

Today FamCal serves one household. Its data sits in the `famcal` schema of a Supabase project it shares with other apps. Accounts exist only by invitation, and every query assumes a single household row (`famcal.household`, `id = 1`).

This spec opens FamCal to the public:

- anyone can **sign up on their own**;
- each person who signs up gets their own household, connects their own Google calendars and SmugMug galleries, and invites their family;
- no household can see, change or infer anything about another.

**Goals**

- Self sign-up with email and password, email confirmation, and a guided setup that ends with a working display.
- Hard separation between households, enforced in the app **and** in the database.
- Hard separation between **who signs in** and **which accounts a household has connected** (see "Sign-in is not a connected account"). Connecting Google or SmugMug never signs anyone in, and signing in never grants access to a connected account.
- Self-service invitations, account deletion and data export.
- Google OAuth verified for public use, so connections don't expire after 7 days or stop at 100 users.
- Your family keeps working throughout, as the first household, with no visible change during the groundwork phase.

**Non-goals (this phase)**

- Billing and paid plans (the design leaves room; see Open decisions).
- Belonging to more than one household at a time.
- Non-Google calendars, and photo sources other than SmugMug.
- An admin console beyond what an operator needs to suspend abuse (MT-41).

## Key decisions

| # | Decision | Default in this spec | Why |
|---|---|---|---|
| D1 | Shared Supabase project vs a dedicated one | **Dedicated project for FamCal** (see Open decisions to stay shared) | Self sign-up needs public sign-up turned on, and in Supabase that switch applies to the whole project, so it would open sign-up for the other apps too. It would also mix strangers' accounts with theirs. A dedicated project gives FamCal its own sign-up switch, email templates, rate limits and backups. If it stays shared, sign-up must go through FamCal's server with the admin API instead (MT-3). |
| D2 | Households per user | **One** | Every screen stays simple. Membership is a table, so many-to-many can come later. |
| D3 | SmugMug | **Public/Unlisted galleries with the app's API key** (as today), with private galleries through per-household SmugMug OAuth later | OAuth 1.0a is a sizable piece of work; Unlisted covers most families. |
| D4 | Price | **Free** | Keeps launch simple; quotas (MT-40) cap cost. |
| D5 | Operator named in the legal pages | **Anderson Quach** (as today) | Change `components/legal.tsx` if it should be Auratech Labs. |

## Roles

- **Owner:** the person who signed up and created the household. Can do everything, including deleting the household and transferring ownership.
- **Member:** invited by an owner. Uses the display and Settings (behind the PIN, as today). Cannot delete the household, change roles or remove the owner.
- **Operator:** you. Can suspend a household for abuse. Has no in-app view of households' calendars or photos.

## Sign-in is not a connected account (key principle)

FamCal deals with four kinds of identity. They are kept apart in the data model and in code, and none of them can stand in for another:

| Identity | What it is | Keyed by | Used for | Never used for |
|---|---|---|---|---|
| **Login** | A person's FamCal account (email and password, Supabase Auth) | `auth.users.id` (`user_id`) | Proving who a person is; finding their household membership | Reading calendars or photos; matching to anything by email |
| **Connected account** | A Google or SmugMug account a household authorized as a data source | The provider's stable id (Google `sub`) within a household | Fetching and writing that household's calendars or photos with an encrypted token | Signing anyone in; deciding membership; identifying a person |
| **Display device** | A paired screen (the wall iPad) | `device_id` | Showing the display for one household | Account management (password, email, members, deletion) |
| **Contact** | A family-member entry or an event guest's email address | Plain data inside the household | Guest chips and suggestions | Signing in, invitations or access of any kind |

A login's email and a connected Google account's email are different facts, even when they are the same string. FamCal never treats one as the other.

- **MT-15 No sign-in through a connected account.**
  - Connecting Google or SmugMug never creates, signs in or links a FamCal login.
  - The connection callback sets no session cookie and never reads or writes `auth.users`.
  - There is no "Sign in with Google" in this phase. If one is added later, it uses a separate OAuth client asking only for `openid email`, stores no Google token, and cannot connect calendars. Connecting calendars likewise can't sign anyone in.
- **MT-16 Never link by email.** No code path finds or joins a login, a household, a membership, an invitation or a connected account by comparing email addresses.
  - Memberships are keyed by `user_id` only; `members.email` is removed, and lists read the email from Auth by `user_id`.
  - Invitations are accepted by an explicit action of a signed-in login, bound to its `user_id` at that moment (MT-12). The invitation's email is only where it was sent.
  - Today's invite fallback that looks up `auth.users` by email (`app/api/settings/route.ts`) is removed.
  - A Google connection whose email equals a member's login email gains nothing from it.
- **MT-17 Connected accounts belong to the household.**
  - A connection is keyed by `(household_id, google_sub)`. Its email, name and picture are display labels, refreshed when the token is refreshed.
  - `connected_by` records which login connected it, for the audit log only; it grants nothing.
  - Refresh tokens are encrypted with AES-256-GCM, with `household_id` and the connection id as associated data. A token row copied to another household, or to another connection, fails to decrypt.
  - Tokens never leave the server: never in API responses, logs, exports or error messages.
  - A reconnect hint (`login_hint`) uses the connection's own email, never the signed-in person's login email.
- **MT-18 Independent lifecycles.**
  - Changing a login's email or password, or deleting a login, leaves the household's connections untouched. Disconnecting an account leaves every login untouched.
  - When a member leaves or is removed, the accounts they connected stay with the household. The leaving member sees the list first, with "Disconnect" ticked by default for each one, so a personal calendar doesn't stay behind by accident. The owner is told what was kept.
  - Deleting a household deletes its connections and memberships, **not** its members' logins (MT-37).
- **MT-19 Display devices are not people.**
  - Today the wall iPad is signed in as a person-style login. Instead, an owner pairs a display: Settings → Devices shows a short code, the display enters it, and the display receives a household-scoped, revocable device credential.
  - That credential runs the display, including adding and editing events, and opens Settings only with the PIN. It can never change a login's password or email, manage members, or delete anything account-level.
  - Devices are listed with their last-seen time and can be revoked; revoking one signs it out within a minute.

## Functional requirements

### Self sign-up and sign-in

- **MT-1 Sign-up page.** `/signup`, linked from `/login` ("Create an account").
  - Fields: name, email, password (at least 10 characters, checked against Supabase's leaked-password protection), and a required checkbox "I agree to the Terms and Privacy policy" linking to `/terms` and `/privacy`.
  - Same layout and styling as the login card.
- **MT-2 Email confirmation.** Sign-up sends a confirmation link; the account can't sign in until it's confirmed.
  - The link lands on `/auth/confirm?next=/setup`.
  - Unconfirmed accounts are deleted after 7 days.
  - Re-submitting the form for an unconfirmed email re-sends the link and does not reveal whether the address already has an account. The response is the same either way: "Check your email".
- **MT-3 Where accounts are created.**
  - With a dedicated project (D1 default): Supabase `auth.signUp`, with public sign-up turned on for that project only.
  - With the shared project: a FamCal server action calls `auth.admin.createUser` and sends the confirmation link itself; the project's public sign-up switch stays off.
  - Either way, the browser never gets the admin key.
- **MT-4 Bot and abuse protection on sign-up.**
  - Cloudflare Turnstile (or hCaptcha) on the sign-up and password-reset forms, verified on the server.
  - Rate limits per IP address and per email address (MT-40).
  - Disposable-email domains are refused.
- **MT-5 Email delivery.** All auth email (confirm, reset, invite, change email) goes through a real email sender (SMTP through Resend or Postmark):
  - from `no-reply@<famcal-domain>`;
  - with SPF, DKIM and DMARC records set up;
  - with branded templates.
  - Supabase's built-in sender is limited to a few emails an hour, which doesn't work for public sign-up.
- **MT-6 Sign-in after sign-up.** Signing in with a confirmed account that has no household goes to `/setup`. Sign-in, password reset and the members check otherwise work as today.
  - If FamCal stays on the shared project (D1), a login that exists for another app gets no FamCal membership from that. It sees "Create a household or ask for an invite", and its existing password is never used to join anything automatically.
- **MT-7 Change email and password.** A signed-in user can change both from Settings → Account.
  - Changing email confirms the new address and notifies the old one.

### Households and setup

- **MT-10 Create household.** The first step of `/setup` asks for a household name (prefilled "<Name>'s family") and the time zone (detected from the browser, editable).
  - Creating it makes the user its **owner**.
- **MT-11 Setup steps.** After the household exists, `/setup` walks through these steps, each skippable except the PIN:
  1. ZIP code and units (weather).
  2. Connect Google and pick calendars (MT-20).
  3. Add a SmugMug gallery link (MT-30).
  4. Set the 4-digit Settings PIN.
  5. "Open the display" with tips (add to Home Screen, Guided Access).
  - Progress is saved on the server, so leaving and coming back resumes at the same step.
  - A household with no Google calendar shows an empty-state call to action on the display instead of a blank grid.
- **MT-12 Invitations.** The owner (and members, behind the PIN) invite by email from Settings → Members.
  - An invite email links to `/join/<token>`. The invitee signs in or signs up (any email; it doesn't have to match the invited address, per MT-16), then presses "Join <household>". The membership is created for that login's `user_id`.
  - **No one is ever added without accepting**, and never by matching an email to an existing account. The owner is notified which login joined, with its email, and can remove it.
  - Invite tokens are random, stored only as a hash, and single use.
  - Invites expire after 7 days and can be revoked.
  - A user who already belongs to a household must leave it before joining another (D2).
- **MT-13 Members.** Settings → Members lists members with their role. The owner can:
  - remove a member;
  - transfer ownership to another member;
  - change the household name.
  - Members can leave.
  - The last owner can't leave without transferring ownership or deleting the household.
  - Removing a member ends their access at once: the next request from any of their sessions gets 403. Their login itself keeps working for other purposes.
- **MT-14 Household settings are per household.** Everything in today's `famcal.household` row becomes per household:
  - weather location, units, outdoor keywords, rotation speed, night hours, family members, photo sources;
  - the PIN, with its own lockout counter.
  - Wrong PIN guesses in one household never lock out another.

### Google calendars

- **MT-20 Connect Google per household.** "Connect Google" works as today (FR-48 onward) but the connection belongs to the caller's household.
  - The OAuth `state` cookie also binds the household id and the `user_id` (or device id) that started the flow. The callback refuses to finish unless the same login or device, still a member of that household, completes it.
  - The callback only stores the connection (MT-15, MT-17).
- **MT-21 Same Google account in two households.** Allowed. Each household holds its own connection and refresh token, and disconnecting in one doesn't affect the other.
  - Connections are unique by `(household_id, google_sub)`, replacing today's unique `email`. A Google account that changes its email stays the same connection.
- **MT-22 Per-household calendar choices.** Calendar list, colours, the "shown" flag and the family-account flag are all per household.
- **MT-23 OAuth verification.** Before public launch the Google Cloud project's OAuth consent screen is moved to **In production** and passes Google's verification for the sensitive scope `calendar.events`. That needs:
  - a verified domain;
  - a home page describing FamCal;
  - the privacy policy (done, `/privacy`);
  - the terms (done, `/terms`);
  - a demo video of the consent flow.
  - Until then, at most 100 named test users, and their tokens expire after 7 days.
- **MT-24 Fewer polls (recommended before launch).** Replace 60-second polling with Calendar push notifications (watch channels, already listed as v2 in FR-16), or at least poll hidden displays less often, to stay inside Calendar API per-project quotas as households grow.

### Photos

- **MT-30 Gallery links per household.** Photo sources are stored per household (today's `photo_sources`). The photo-list cache key includes the household id.
  - Galleries must be Public or Unlisted; the error for a private gallery says how to make it Unlisted.
- **MT-31 Private galleries (later).** "Connect SmugMug" with SmugMug OAuth 1.0a per household:
  - encrypted token storage (`smugmug_accounts`);
  - disconnect revokes access;
  - photo URLs served through FamCal so tokens never reach the browser.
- **MT-32 SmugMug terms.** Confirm SmugMug's API terms allow one API key to be used for many customers before launch; otherwise each household supplies its own key or uses MT-31.

### Data separation

- **MT-33 Every request is scoped to one household.**
  - `requireMemberApi` / `requireMemberPage` return `{ userId, householdId, role }`.
  - Every query on a household table filters by that `householdId`.
  - Any id that comes from the browser (account id, calendar id, event reference, member id) is checked against the caller's household before use, and refused with 404 if it isn't theirs.
- **MT-34 Database-enforced separation.** The database itself also refuses cross-household access:
  - The app connects as a dedicated role **without** `bypassrls`.
  - Each request runs in a transaction that first does `set local app.household_id = '<uuid>'`.
  - Row-level security policies on every household table allow only rows where `household_id = current_setting('app.household_id')::uuid`.
  - Sign-up, invites and the operator tools use a separate, narrowly granted role.
- **MT-35 Shared data stays harmless.** Weather readings stay shared, keyed by rounded coordinates; they hold nothing personal. Every other cache entry is keyed by household.
- **MT-36 Device data.** The display's offline copy in `localStorage` (events, weather, photo list) is keyed by household and cleared on sign-out, so a shared iPad never shows the previous household's events.

### Account deletion and export

- **MT-37 Delete household.** The owner can delete the household from Settings → Account, behind the PIN and by typing the household name. Deletion:
  - revokes every Google token at Google;
  - deletes every row for the household;
  - unpairs every display device;
  - leaves members' **logins** in place (MT-18): they can sign in, create or join another household, or delete their login (MT-38). Each member gets an email saying the household was deleted.
  - Backups age out within 30 days (stated in `/privacy`).
- **MT-38 Delete my account.** Any member can delete their own account; an owner must transfer ownership or delete the household first.
- **MT-39 Export.** The owner can download a JSON file with the household's settings, members, connected accounts (without tokens) and calendar choices.
  - Events and photos stay in Google and SmugMug and are not exported.

### Abuse, limits and operations

- **MT-40 Rate limits.** Database-backed counters, keyed by IP address and by account or household:
  - sign-up: 5 per IP per hour;
  - sign-in: 10 failures per account per 15 minutes, then a delay;
  - password reset and invites: 5 per hour;
  - PIN: today's lockout, per household;
  - event writes: 120 per household per minute.
- **MT-41 Operator tools.** A CLI script (not a web page) to:
  - suspend or unsuspend a household (its members see "This household is suspended");
  - list households with created date, member count and last activity;
  - delete a household on request.
  - It never shows calendar content.
- **MT-42 Monitoring.** Error reporting with household ids, never emails or event text.
  - Alerts on the 5xx rate, Google auth failures and Calendar API quota use.
  - Daily counts of sign-ups and active displays.
- **MT-43 Quotas.**
  - Per household: up to 10 members, 10 Google accounts, 30 shown calendars, 10 photo sources.
  - These are configurable constants; going over shows a clear message.

- **MT-46 Audit log.** Per household, an append-only log of security-relevant events, visible to the owner in Settings → Activity:
  - account connected or disconnected (with `connected_by`);
  - invite sent, accepted or revoked;
  - member joined, left or removed; role changed;
  - device paired or revoked; PIN changed; export; deletion requested.
  - Entries reference `user_id`, device id and connection id. Emails shown in the list are resolved at display time.

### Legal and product text

- **MT-44 Legal pages.** Before launch, update `/privacy` and `/terms`:
  - drop "invitation only";
  - describe self sign-up, the email sender and Turnstile as processors, self-service deletion, backup retention, and suspension for abuse.
  - Bump the effective date and email existing members about the change.
- **MT-45 Home page.** A public landing page at `/` for signed-out visitors (what FamCal is, screenshots, "Create an account", links to Privacy and Terms). It is also needed for Google verification.
  - Signed-in members still get the display at `/`.

## Data model

New migration in `db/migrations`. All tables stay in the `famcal` schema (or the dedicated project's equivalent).

| Table | Columns / changes |
|---|---|
| `households` (new, replaces `household`) | `id uuid pk`, `name`, `time_zone`, `created_by uuid`, `created_at`, `suspended_at`, `setup_step`, plus every column of today's `household` row: weather, units, keywords, rotation, night hours, `family_members`, `photo_sources`, and the `pin_*` fields |
| `members` | add `household_id uuid not null references households on delete cascade`, `role text check (role in ('owner','member'))`; pk `(household_id, user_id)`; unique `(user_id)` while D2 holds; **drop `email`** (MT-16) |
| `invitations` (new) | `id`, `household_id`, `sent_to` (delivery address only), `invited_by`, `token_hash`, `expires_at`, `accepted_by` (`user_id`), `accepted_at`, `revoked_at` |
| `google_accounts` | add `household_id`, `google_sub`, `connected_by` (audit only); unique `(household_id, google_sub)` replaces unique `(email)`; `email`, `name`, `picture` become labels; token re-encrypted with associated data (MT-17) |
| `calendars` | add `household_id`; pk `(household_id, account_id, calendar_id)` |
| `cache` | keys prefixed `h:<household_id>:` for photos and recent guests; weather keys unchanged |
| `rate_limits` (new) | `key`, `window_start`, `count` |
| `devices` (new) | `id`, `household_id`, `name`, `credential_hash`, `paired_by`, `paired_at`, `last_seen_at`, `revoked_at` |
| `pairing_codes` (new) | `code_hash`, `household_id`, `created_by`, `expires_at` (10 minutes), `used_at` |
| `audit_log` (new) | `id`, `household_id`, `at`, `actor_user_id` or `actor_device_id`, `action`, `target_id`, `detail jsonb` (no tokens, no event content) |
| `smugmug_accounts` (new, MT-31) | `household_id`, encrypted token and secret, `nickname`, `created_at` |

See "Migrating existing users" below for how today's data moves into these tables.

## Migrating existing users

Today there is one household and two logins. Real addresses are kept out of this public repo, as in the product spec:

| Today | Kind | Facts (checked Oct 30, 2026) | After migration |
|---|---|---|---|
| `<owner>` | Login (email and password, no Google sign-in) | Founded the household (`added_by` is null) | **Owner** of household #1 |
| `<family-account>` | Login (email and password, no Google sign-in) | Invited by `<owner>`; the login the wall iPad uses | **Member** of household #1, until the owner chooses to remove it |
| `<family-account>` Google | Connected account | The family account (`is_family`); 4 calendars, all shown | Connection of household #1, keyed by its Google `sub`; `connected_by` null and an audit entry "migrated" |
| Household row `id = 1` | Settings | ZIP, PIN, 1 photo source, no family-member entries | Household #1 (name "Quach family", Pacific time) with the same settings, PIN and lockout state |
| `famcal.cache` | Caches | Weather, photos, recent guests | Weather kept; photo list rebuilt (fetched again within the hour); **recent guests moved** under the household's key, so guest suggestions survive |

`<family-account>` is both a login and a connected Google account. That is exactly the case MT-15–18 exist for:
- **Two rows, two meanings.** After the migration they are different rows in different tables, and nothing links them.
- **No cross-effects.** Removing the login doesn't disconnect the calendar, and disconnecting the calendar doesn't affect the login.
- **The match grants nothing.** The fact that the two addresses match gives `<family-account>` no extra rights.

**Principles**

- **No one is re-invited or asked to sign up again**, and no password changes. Both people keep their logins.
- **Nothing is matched by email.** The migration carries `user_id`s across; the one Google connection gets its `sub` from Google, not from its email.
- **Nothing outside FamCal changes.** Rows in the shared project's `auth.users` are never edited or deleted (other apps may use them).
- **Reversible until signed off.** The old tables stay, renamed `*_v1` and unused, until the checks below pass and two weeks have gone by.

**Step 1: in place (phase A, on the current Supabase project).** One migration in a transaction:

1. Create `households`. Insert household #1 from the `household` row. Record its uuid in a one-row `migration_v1` table, so later steps and the rollback can find it.
2. Add `household_id` to `members`, `google_accounts` and `calendars`, filled with that uuid. Set `role = 'owner'` for the member with null `added_by` and `'member'` for the other. Make the columns `not null` and add the new keys.
3. Move the recent-guests cache entry to its household-prefixed key, and delete the photo-list entry.
4. Rename the old `household` table to `household_v1`; keep `members.email` for now (dropped in step 3).
5. Write audit entries: "household migrated", "member migrated" for each login, "account migrated" for the connection.

Then, before the new code goes live, a one-off script (not SQL, since it calls Google):

6. For the connection: use its refresh token to call Google's userinfo endpoint and store `google_sub`. Re-encrypt the token with the new associated data (MT-17). Make `google_sub` `not null` and switch the unique key to `(household_id, google_sub)`.
   - If Google refuses the token, the connection is marked `reconnect`, which the display already handles. A reconnect lands on the same household and is keyed by `sub` from then on.
7. Deploy the household-scoped code. Run the checks below.

**Step 2: the wall iPad (phase A2).**

8. The owner pairs the iPad as a display device (MT-19). The display then runs on its device credential instead of the `<family-account>` login.
9. The owner decides whether `<family-account>` stays a member, for signing in from a phone. Removing it later affects nothing else.

**Step 3: a dedicated Supabase project (only if D1 stays "dedicated", before phase B).**

10. Copy the FamCal tables to the new project.
11. Copy the two logins with the Auth admin API: same email, same bcrypt password hash, email confirmed.
    - Keep their `user_id`s if the API allows setting the id. Otherwise write an old-to-new id map, apply it to `members`, `invitations`, `audit_log` and `connected_by`, and keep the map with the migration.
    - Both people keep their passwords. Their current sessions end, so each signs in once more; the paired iPad is unaffected because device credentials live in FamCal's tables.
12. Point the app at the new project (environment variables and secrets in Cloud Run). The old project's FamCal tables are kept, read-only, until sign-off. Its `auth.users` rows are left exactly as they are.
13. Drop `members.email` and, after sign-off, the `*_v1` tables.

**Checks (each step must pass before the next)**

- **Row counts:** 1 household; 2 memberships (1 owner, 1 member); 1 Google connection with a `google_sub`; 4 calendars, all shown; photo sources 1; PIN unchanged (the old PIN still unlocks Settings).
- **Display unchanged:** the same events, colours and photos as before the migration, compared with a screenshot taken just before.
- **Separation:** a test household B created on staging sees none of household #1's rows, through the API and with row-level security alone.
- **Sign-in:** both people can sign in with their current passwords. A password reset email reaches each of them.
- **Identity:** no row links the `<family-account>` login to the `<family-account>` Google connection.

**Rollback**

- **Before step 3:** redeploy the previous revision. The `household_v1` table and the unchanged `members`, `google_accounts` and `calendars` columns let it run as before, since the added columns are ignored by the old code.
- **After step 3:** point the app back at the old project. Nothing there was changed.

## Code changes (by file)

- **`lib/auth.ts`:** member checks return `{ userId, householdId, role }`; add `requireOwner`. Add a `withHousehold(householdId, fn)` helper in `lib/db.ts` that opens a transaction and sets `app.household_id`.
- **`lib/household.ts`:** `getHousehold(householdId)`, `updateHousehold(householdId, …)`; cache helpers take a household for non-shared keys.
- **`lib/google.ts`** (11 queries): every account and calendar query takes the household; the OAuth state carries it; uniqueness per household.
- **`lib/events.ts`:** `assertWritable` and the guest cache are household-scoped; `listEvents(householdId, …)`.
- **`lib/pin.ts`** (8 queries): PIN and lockout per household.
- **`lib/smugmug.ts`:** sources and cache key per household.
- **`app/api/settings/route.ts`** (17 queries): every action scoped and ownership-checked; invites move to the `invitations` table and accept flow (MT-12); the `auth.users` lookup by email is removed (MT-16); new actions for members, transfer, delete, export.
- **`app/api/google/*`:** state binds the household and the starting login or device (MT-20). The callback stores the connection only, keyed by `sub`, and never touches Auth (MT-15).
- **`lib/crypto.ts`:** `encrypt`/`decrypt` take associated data; a helper builds it from household and connection ids (MT-17).
- **Device auth:** new `app/api/devices/*` (pair, revoke) and a device-credential check alongside the session check in `lib/auth.ts` (MT-19).
- **`lib/supabase/proxy.ts`:** public paths add `/signup`, `/setup` (signed-in only), `/join`, and the landing page.
- **New pages:** `app/signup`, `app/setup`, `app/join/[token]`, Settings → Account, Settings → Members updates, landing page.
- **`components/display/*`:** offline-cache keys per household (MT-36); empty state for a household with no calendars.

## Testing

- **Unit:** every changed module keeps its tests, plus a separation test. With the fake database (`test/fake-sql.ts`), run each API route as a member of household A and assert that **every** query on a household table includes A's id and none returns B's rows.
- **Database:** against a real Postgres (Supabase local or a branch), log in as the app role with `app.household_id` set to A and confirm the row-level security policies hide B's rows for select, update and delete.
- **End to end** (Playwright):
  1. Sign up and confirm.
  2. Set up a household and connect a Google test account.
  3. See the display.
  4. Invite a second user, who accepts.
  5. Delete the household.
  - Plus a second household that must never see the first's data.
- **Identity separation** (MT-15–19):
  - The Google and SmugMug callbacks never set a session cookie and never query the `auth` schema (fake-database assertion).
  - A static check fails the build if any SQL compares a login's email with anything (`auth.users` joined or filtered by `email`).
  - Connecting a Google account whose email equals a member's login email changes no membership and grants that member nothing.
  - A token row copied into another household fails to decrypt.
  - Joining through an invite records the accepting `user_id` whatever the invited address was.
  - A device credential is refused on every account-management route.
- **Security review** before launch: changing ids, replaying OAuth state, reusing invites, enumerating accounts through sign-up and reset messages, and rate limits.

## Phasing

| Phase | Scope | Exit criteria |
|---|---|---|
| A. Groundwork | Data model and migration, household-scoped queries, row-level security role, identity separation (MT-15–18: no email linking, connections keyed by `sub`, tokens bound to their household), separation tests | Your family runs unchanged as household #1; all separation tests pass |
| A2. Devices | Display pairing (MT-19), audit log (MT-46) | The wall iPad runs on a device credential |
| B. Accounts | MT-1–7 (self sign-up), email sender, Turnstile, setup steps, invitations with accept, members and roles, rate limits | A stranger can sign up, set up and invite family on a staging deploy |
| C. Google | Submit OAuth verification as soon as B is demoable; up to 100 test users meanwhile; MT-24 push or reduced polling | Verification approved; consent screen "In production" |
| D. Trust | Delete and export (MT-37–39), operator tools, monitoring, quotas, updated legal pages, landing page | Checklist below passes |
| E. Later | SmugMug OAuth (MT-31), multiple households per user, billing | — |

## Launch checklist

- [ ] A new visitor can sign up, confirm their email and reach a working display in under 5 minutes.
- [ ] Sign-up and reset messages read the same for existing and new emails.
- [ ] A member of household A gets 404 for every household-B id tried on every API route.
- [ ] With the app's database role, household B's rows are invisible when `app.household_id` is A.
- [ ] Deleting a household revokes its Google tokens and leaves no rows behind, while its members can still sign in.
- [ ] No code path links a login to a connected account, household or invitation by email; the identity-separation tests pass.
- [ ] The wall display runs on a paired device credential, not a person's login.
- [ ] Both existing people sign in with their current passwords, and household #1 passes the migration checks.
- [ ] Google OAuth consent screen verified and in production.
- [ ] Auth emails arrive from FamCal's domain and pass SPF, DKIM and DMARC.
- [ ] `/privacy` and `/terms` updated and existing members notified.

## Open decisions

- **D1:** dedicated Supabase project (default) or stay shared with sign-up through the admin API? A dedicated project means migrating the existing tables and the users who belong to FamCal.
- **D2:** should anyone need two households (shared custody, grandparents)? If yes, add a household switcher and drop the unique `user_id` on `members`.
- **D3:** is Unlisted-only SmugMug acceptable for launch?
- **D4:** stay free, or plan for paid plans (and which limits they would lift)?
- **D5:** operator name: Anderson Quach or Auratech Labs?
- Which email sender (Resend or Postmark), and which domain sends auth email?
