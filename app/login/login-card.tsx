"use client";

import { useActionState, useState } from "react";
import { sendReset, signIn, type FormState } from "./actions";
import { PasswordField } from "@/components/auth/password-field";

export function LoginCard({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [signInState, signInAction, signingIn] = useActionState<FormState, FormData>(signIn, {});
  const [resetState, resetAction, sending] = useActionState<FormState, FormData>(sendReset, {});

  if (mode === "reset") {
    return (
      <form className="auth-card" action={resetAction}>
        <div>
          <h1 className="auth-title">Reset password</h1>
          <p className="auth-subtitle">We&rsquo;ll email you a link to set a new one.</p>
        </div>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            className="input"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            defaultValue={resetState.email ?? signInState.email}
          />
        </label>
        {resetState.message && <p className="auth-note">{resetState.message}</p>}
        <button className="btn btn-primary btn-block" disabled={sending}>
          {sending ? <span className="spinner" aria-label="Sending" /> : "Send reset link"}
        </button>
        <button type="button" className="btn-text" onClick={() => setMode("signin")}>
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form className="auth-card" action={signInAction}>
      <div>
        <h1 className="auth-title">Family Calendar</h1>
        <p className="auth-subtitle">Sign in to continue</p>
      </div>
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span className="field-label">Email</span>
        <input
          className="input"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          defaultValue={signInState.email}
        />
      </label>
      <PasswordField name="password" label="Password" autoComplete="current-password" />
      {signInState.error && (
        <p className="auth-error" role="alert">
          {signInState.error}
        </p>
      )}
      <button className="btn btn-primary btn-block" disabled={signingIn}>
        {signingIn ? <span className="spinner" aria-label="Signing in" /> : "Sign in"}
      </button>
      <button type="button" className="btn-text" onClick={() => setMode("reset")}>
        Forgot password?
      </button>
    </form>
  );
}
