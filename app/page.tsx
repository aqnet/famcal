import { requireMemberPage } from "@/lib/auth";
import { listAccounts } from "@/lib/google";
import { Display } from "@/components/display/display";
import { googleStatusText } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  await requireMemberPage();
  const status = googleStatusText((await searchParams).google);
  const accounts = await listAccounts();

  // One-time setup until the first Google account is connected (FR-1).
  if (!accounts.length) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div>
            <h1 className="auth-title">Connect Google</h1>
            <p className="auth-subtitle">
              Sign in with the family Google account. The display reads and edits its calendars; you can add
              personal accounts later in Settings.
            </p>
          </div>
          {status?.error && (
            <p className="auth-error" role="alert">
              {status.text}
            </p>
          )}
          <a className="btn btn-primary btn-block" href="/api/google/connect">
            Connect Google
          </a>
          <p className="auth-note">
            famcal asks to view and edit events on your calendars and to list them. Tokens stay on the server.
          </p>
        </div>
      </main>
    );
  }

  return <Display />;
}
