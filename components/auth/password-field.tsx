"use client";

import { useState } from "react";

export function PasswordField({
  name,
  label,
  autoComplete,
  minLength,
}: {
  name: string;
  label: string;
  autoComplete: string;
  minLength?: number;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="input-with-button">
        <input
          className="input"
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}
