"use client";

import { useActionState } from "react";
import { setPassword, type ResetState } from "./actions";
import { PasswordField } from "@/components/auth/password-field";

export function ResetCard({ email }: { email: string }) {
  const [state, action, saving] = useActionState<ResetState, FormData>(setPassword, {});
  return (
    <form className="auth-card" action={action}>
      <div>
        <h1 className="auth-title">Set a password</h1>
        <p className="auth-subtitle">{email}</p>
      </div>
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <PasswordField name="password" label="New password" autoComplete="new-password" minLength={8} />
      <PasswordField name="confirm" label="Confirm password" autoComplete="new-password" minLength={8} />
      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary btn-block" disabled={saving}>
        {saving ? <span className="spinner" aria-label="Saving" /> : "Save password"}
      </button>
    </form>
  );
}
