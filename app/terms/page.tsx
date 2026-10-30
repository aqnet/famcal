import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL, LegalPage, Mail } from "@/components/legal";

export const metadata: Metadata = {
  title: "Terms of service · FamCal",
  description: "The terms for using FamCal.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms cover your use of FamCal, a private family calendar display operated by {LEGAL.operator}{" "}
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;) at <a href={LEGAL.site}>{LEGAL.site.replace("https://", "")}</a>.
        By signing in or connecting an account, you agree to them. If you don&rsquo;t agree, please
        don&rsquo;t use FamCal.
      </p>

      <h2>The service</h2>
      <p>
        FamCal shows a household&rsquo;s Google calendars, photos and local weather on a shared screen, and
        lets household members add and change events. It is offered free of charge, by invitation only, to the
        households we choose. We may change, suspend or stop the service, or any feature of it, at any time.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 13 years old, and old enough to agree to these terms where you live.</li>
        <li>
          Keep your password and the household PIN to yourselves; you are responsible for what happens under
          your account and on your household&rsquo;s display.
        </li>
        <li>Only invite people who belong in your household&rsquo;s calendar.</li>
      </ul>

      <h2>Your content and connected accounts</h2>
      <p>
        Your calendars, events, photos and settings remain yours. You give us permission to access, store and
        process them only as needed to run FamCal for your household, as described in our{" "}
        <Link href="/privacy">privacy policy</Link>. You can disconnect a Google account in Settings or from
        your Google Account at any time.
      </p>
      <p>
        Changes you make on the display, such as adding, moving or deleting events or inviting guests, are
        made in your Google Calendar and may send emails to guests. Check before you save.
      </p>
      <p>
        Your use of Google, SmugMug and the other services FamCal connects to is also governed by their own
        terms.
      </p>

      <h2>Acceptable use</h2>
      <p>Don&rsquo;t:</p>
      <ul>
        <li>use FamCal to break the law or to harm, harass or spam anyone;</li>
        <li>connect accounts or photos you don&rsquo;t have the right to use;</li>
        <li>try to get into accounts, data or parts of the service that aren&rsquo;t yours;</li>
        <li>interfere with, overload or reverse-engineer the service.</li>
      </ul>
      <p>We may suspend or remove access that breaks these rules.</p>

      <h2>No warranty</h2>
      <p>
        FamCal is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind,
        express or implied, including fitness for a particular purpose and non-infringement. Calendar,
        reminder, photo and weather information may be late, incomplete or wrong; don&rsquo;t rely on FamCal
        for anything where a missed or inaccurate entry could cause harm.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent the law allows, we are not liable for any indirect, incidental, special,
        consequential or punitive damages, or for lost data, missed appointments or lost profits, arising from
        your use of FamCal. Our total liability for any claim about the service is limited to US $50. Some
        places don&rsquo;t allow these limits, so they may not all apply to you.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using FamCal at any time and ask us to delete your information. We may end your access if
        you break these terms or if we stop offering the service. The sections on your content, no warranty,
        limitation of liability and governing law continue after that.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Washington, USA, without regard to its
        conflict-of-law rules. Any dispute will be resolved in the state or federal courts located in King
        County, Washington, and you and we consent to their jurisdiction.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. We will post the new version here with a new effective date and, if the
        change matters, tell members before it takes effect. Continuing to use FamCal after that means you
        accept the updated terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <Mail />.
      </p>
    </LegalPage>
  );
}
