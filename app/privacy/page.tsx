import type { Metadata } from "next";
import { LEGAL, LegalPage, Mail } from "@/components/legal";

export const metadata: Metadata = {
  title: "Privacy policy · FamCal",
  description: "What FamCal collects, how it is used, and the choices you have.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        FamCal is a private family calendar display operated by {LEGAL.operator} (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;) at <a href={LEGAL.site}>{LEGAL.site.replace("https://", "")}</a>. It shows a
        household&rsquo;s Google calendars, a photo slideshow and the local weather on a wall-mounted tablet.
        It is not open to the public: only people a household member invites can sign in. This policy explains
        what the service collects, why, who it is shared with, and the choices you have.
      </p>

      <h2>Information we collect</h2>
      <h3>Your sign-in account</h3>
      <p>
        Your email address and a password (stored only as a one-way hash by our authentication provider), plus
        a membership record noting who invited you and when.
      </p>

      <h3>Google account data</h3>
      <p>When a household member connects a Google account, FamCal receives, with their permission:</p>
      <ul>
        <li>
          The account&rsquo;s email address, name and profile picture (Google scopes <code>openid</code>,{" "}
          <code>email</code>, <code>profile</code>).
        </li>
        <li>
          The list of calendars on that account, with their names and your access level (
          <code>calendar.calendarlist.readonly</code>), so you can choose which ones to show.
        </li>
        <li>
          Calendar events (<code>calendar.events</code>): titles, times, locations, notes, guests and
          reminders, read so they can be shown on the display. FamCal creates, changes or deletes an event, or
          answers an invitation, only when someone does that on the display.
        </li>
        <li>
          An OAuth refresh token, so the display keeps working without signing in again. It is encrypted
          (AES-256-GCM) before it is stored.
        </li>
      </ul>
      <p>
        Calendar events are not stored on our servers; they are fetched from Google each time the display
        refreshes. The one exception is the email addresses of people invited to events, which are kept for up
        to 90 days so the display can suggest them when adding guests.
      </p>

      <h3>Household settings</h3>
      <p>
        The settings a household enters: family members&rsquo; names and email addresses, the ZIP code used
        for weather (and the town and coordinates it resolves to), photo gallery links, calendar colours and
        display preferences, and a PIN that guards the settings (stored only as a hash).
      </p>

      <h3>Stored on the display device</h3>
      <p>
        The tablet&rsquo;s browser keeps a copy of recent events, the weather and the photo list so the
        display still works when the network drops, along with display preferences. This stays on that device.
      </p>

      <h3>Cookies and logs</h3>
      <p>
        FamCal uses only the cookies needed to keep you signed in. There are no advertising or analytics
        cookies and no third-party trackers. Like any web service, our hosting provider records requests (such
        as IP address, browser type and the page requested) in server logs used for security and
        troubleshooting.
      </p>

      <h2>How we use information</h2>
      <p>
        Only to provide FamCal to your household: to sign you in, show and edit your calendars, show photos
        and weather, and keep the service secure and working. We do not sell personal information, use it for
        advertising, or use it to build profiles.
      </p>

      <h2>Google user data</h2>
      <p>
        FamCal&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Google user data is used only to provide the calendar
        features you see on the display. It is not transferred to anyone except as needed to provide those
        features, to comply with the law, or for security; it is not used for advertising; and no person reads
        it unless you ask us to for support, it is needed for security, or the law requires it. Google user
        data is not used to develop, improve or train generalized artificial intelligence or machine-learning
        models.
      </p>

      <h2>Services we rely on</h2>
      <p>FamCal shares only what each one needs to do its job:</p>
      <ul>
        <li>
          <strong>Google</strong>: the Calendar API (your calendars and events) and Google Cloud, which hosts
          the app.
        </li>
        <li>
          <strong>Supabase</strong>: our database and sign-in provider; it stores the information described
          above and sends invitation and password-reset emails.
        </li>
        <li>
          <strong>SmugMug</strong>: the photo galleries a household links; the display loads those photos from
          SmugMug.
        </li>
        <li>
          <strong>Open-Meteo</strong> receives the household&rsquo;s approximate coordinates to return a
          forecast, and <strong>Zippopotam.us</strong> receives the ZIP code to find those coordinates.
          Neither receives anything that identifies you.
        </li>
      </ul>
      <p>
        We may also disclose information if the law requires it, or to protect the safety of people or the
        service.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Account and household settings: until they are removed in Settings or you ask us to delete them.
        </li>
        <li>
          A connected Google account: until it is disconnected in Settings, which revokes FamCal&rsquo;s
          access at Google and deletes the stored token and calendar list.
        </li>
        <li>Event guests&rsquo; email addresses: up to 90 days. Weather readings: about 15 minutes.</li>
        <li>Server logs: kept by our hosting provider for a limited period, typically 30 days.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>
          Disconnect a Google account in FamCal&rsquo;s Settings, or remove FamCal&rsquo;s access at any time
          from your{" "}
          <a href="https://myaccount.google.com/connections">
            Google Account&rsquo;s third-party connections
          </a>
          .
        </li>
        <li>Ask a household member to remove you, or email us to see, correct or delete your information.</li>
      </ul>
      <p>
        We answer requests within 30 days. Depending on where you live, you may have further rights under
        local law; we honour them for everyone.
      </p>

      <h2>Security</h2>
      <p>
        Connections are encrypted with HTTPS, Google tokens are encrypted at rest, only invited members can
        sign in, and changing settings needs the household PIN. No system is perfectly secure, but we work to
        protect your information and will tell affected people promptly if a breach affects them.
      </p>

      <h2>Children</h2>
      <p>
        FamCal is meant for adults managing a household. Children may appear on the display because a parent
        added their name or an event, but we do not knowingly let children under 13 create accounts. If you
        believe a child has given us personal information, contact us and we will delete it.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, we will update it here and change the effective date. If a change matters, we
        will tell members before it takes effect.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <Mail />.
      </p>
    </LegalPage>
  );
}
