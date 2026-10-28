"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/auth/reset";
}

// Picks up access/refresh tokens from an invite link's URL fragment and turns them into a session.
export default function HashSessionPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token") ?? "";
    const refreshToken = params.get("refresh_token") ?? "";
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) setFailed(true);
        else window.location.replace(next);
      });
  }, []);

  return (
    <main className="auth-page">
      <div className="auth-card">
        {failed ? (
          <>
            <h1 className="auth-title">Link expired</h1>
            <p className="auth-subtitle">This link is invalid or has already been used.</p>
            <a className="btn btn-primary btn-block" href="/login">
              Go to sign in
            </a>
          </>
        ) : (
          <p className="auth-subtitle">Signing you in…</p>
        )}
      </div>
    </main>
  );
}
