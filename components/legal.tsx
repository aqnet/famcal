import Link from "next/link";

// Shared details for the public privacy policy and terms (/privacy, /terms).
export const LEGAL = {
  app: "FamCal",
  operator: "Anderson Quach",
  contact: "anderson@auratechlabs.co",
  site: "https://calendar.andersonquach.com",
  effective: "October 30, 2026",
};

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="legal-page">
      <article className="legal">
        <p className="legal-app">{LEGAL.app}</p>
        <h1>{title}</h1>
        <p className="legal-date">Effective {LEGAL.effective}</p>
        {children}
        <nav className="legal-nav" aria-label="Legal">
          <Link href="/privacy">Privacy policy</Link>
          <Link href="/terms">Terms of service</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </article>
    </main>
  );
}

export const Mail = () => <a href={`mailto:${LEGAL.contact}`}>{LEGAL.contact}</a>;
