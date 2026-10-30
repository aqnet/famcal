import Link from "next/link";
import { LEGAL } from "@/components/legal";

const FEATURES = [
  { title: "The whole week", text: "Everyone's Google calendars in one week view, each in its own colour." },
  { title: "Edit by touch", text: "Tap to add an event, then drag it to move it or change how long it runs." },
  { title: "Today's weather", text: "The temperature, the day's low and high, and a forecast when you plan ahead." },
  { title: "Family photos", text: "A mosaic of your favourite photos from your SmugMug galleries." },
];

// Example data for the illustration below: never a real family's events.
const PREVIEW_DAYS = [
  { day: "Mon", date: 9, events: [{ title: "School run", top: 4, height: 12, color: "#4A5560" }] },
  {
    day: "Tue",
    date: 10,
    events: [
      { title: "Dentist", top: 22, height: 14, color: "#A3366F" },
      { title: "Piano lesson", top: 66, height: 14, color: "#6B4FA0" },
    ],
  },
  { day: "Wed", date: 11, events: [{ title: "Soccer practice", top: 58, height: 20, color: "#2E7D32" }] },
  {
    day: "Thu",
    date: 12,
    events: [
      { title: "School run", top: 4, height: 12, color: "#4A5560" },
      { title: "Book club", top: 72, height: 16, color: "#B5501A" },
    ],
  },
  { day: "Fri", date: 13, events: [{ title: "Family dinner", top: 62, height: 22, color: "#6B4FA0" }] },
];

function DisplayPreview() {
  return (
    <figure className="home-preview">
      <div className="home-screen" aria-hidden>
        <div className="home-screen-side">
          <div className="home-screen-clock">8:42</div>
          <div className="home-screen-date">Monday, November 9</div>
          <div className="home-screen-weather">52° Cloudy</div>
          <div className="home-screen-photos">
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="home-screen-week">
          {PREVIEW_DAYS.map((d) => (
            <div key={d.day} className="home-screen-day">
              <div className="home-screen-head">
                {d.day} <strong>{d.date}</strong>
              </div>
              <div className="home-screen-events">
                {d.events.map((e) => (
                  <div
                    key={e.title}
                    className="home-screen-event"
                    style={{ top: `${e.top}%`, height: `${e.height}%`, background: e.color }}
                  >
                    {e.title}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <figcaption>An illustration of the FamCal display, with example events.</figcaption>
    </figure>
  );
}

// What signed-out visitors see at /. Google's OAuth review also reads this page: keep the description of
// how FamCal uses Google data in step with the scopes in lib/google.ts and the privacy policy.
export function HomePage() {
  return (
    <main className="home-page">
      <header className="home-bar">
        <span className="home-brand">
          <img src="/famcal-mark.svg" alt="" width={40} height={40} />
          {LEGAL.app}
        </span>
        <Link className="btn btn-quiet" href="/login">
          Sign in
        </Link>
      </header>

      <section className="home-hero">
        <h1>Your family&rsquo;s week, on the kitchen wall.</h1>
        <p className="home-lead">
          FamCal turns an iPad into a shared family calendar: your Google Calendar events, the weather and
          your family photos, together on one screen.
        </p>
        <p className="home-note">
          FamCal is a private family app. Only people a family member invites can sign in.
        </p>
      </section>

      <DisplayPreview />

      <section className="home-features" aria-label="Features">
        {FEATURES.map((f) => (
          <div key={f.title}>
            <h2>{f.title}</h2>
            <p>{f.text}</p>
          </div>
        ))}
      </section>

      <section className="home-google">
        <h2>How FamCal uses your Google Calendar</h2>
        <p>
          A family member connects a Google account so the display can show and update the family calendar.
          With their permission, FamCal can:
        </p>
        <ul>
          <li>See the account&rsquo;s name, email address and profile picture, to identify it in Settings.</li>
          <li>See the list of calendars, so you can choose which ones to show.</li>
          <li>See calendar events, so they appear on the display.</li>
          <li>
            Create, change and delete events and answer invitations, only when someone does that on the
            display.
          </li>
        </ul>
        <p>
          Events aren&rsquo;t stored on our servers: FamCal fetches them from Google each time the display
          refreshes. The one exception is the email addresses of people invited to events, kept for up to 90
          days to suggest them when adding guests. Google data is never sold or used for advertising. The{" "}
          <Link href="/privacy">privacy policy</Link> has the full details.
        </p>
      </section>

      <footer>
        <nav className="auth-legal" aria-label="Legal">
          <Link href="/privacy">Privacy policy</Link>
          <Link href="/terms">Terms of service</Link>
          <a href={`mailto:${LEGAL.contact}`}>Contact</a>
        </nav>
      </footer>
    </main>
  );
}
