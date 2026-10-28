"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { CloseIcon } from "@/components/icons";

type CheckResult =
  | { ok: true }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "locked"; retryAt: string }
  | { ok: false; reason: "unset" };

// 4-digit PIN entry. mode "set" chooses a new PIN (typed twice).
export function PinPad({
  mode = "check",
  title,
  onDone,
  onCancel,
}: {
  mode?: "check" | "set";
  title?: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [digits, setDigits] = useState("");
  const [first, setFirst] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  // Latest digits, and whether a PIN is being checked, ahead of the next render so fast typing isn't lost.
  const entered = useRef("");
  const busyNow = useRef(false);
  const setEntered = (v: string) => {
    entered.current = v;
    setDigits(v);
  };

  const submit = async (pin: string) => {
    busyNow.current = true;
    try {
      if (mode === "set") {
        if (first === null) {
          setFirst(pin);
          setMessage("Enter it again to confirm");
          return;
        }
        if (first !== pin) {
          setFirst(null);
          setMessage("Those didn't match. Try again.");
          return;
        }
        await api("/api/pin", { body: { action: "set", pin } });
        onDone();
        return;
      }
      const r = await api<CheckResult>("/api/pin", { body: { action: "check", pin } });
      if (r.ok) return onDone();
      if (r.reason === "locked") {
        setMessage(
          `Too many tries. Try again at ${new Date(r.retryAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`,
        );
      } else if (r.reason === "wrong") {
        setMessage(r.attemptsLeft <= 2 ? `Wrong PIN. ${r.attemptsLeft} tries left.` : "Wrong PIN.");
      } else setMessage("No PIN has been set yet.");
    } catch {
      setMessage("Couldn't check the PIN. Are you online?");
    } finally {
      setEntered("");
      busyNow.current = false;
    }
  };

  const press = (k: string) => {
    if (busyNow.current) return;
    if (k === "del") return setEntered(entered.current.slice(0, -1));
    const next = (entered.current + k).slice(0, 4);
    setEntered(next);
    if (next.length === 4) void submit(next);
  };

  // Hardware keyboard: digits (top row or numpad), Backspace/Delete, Escape to cancel. Captured and
  // swallowed so keys don't also reach a field underneath the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // e.code covers the number pad with Num Lock off, where e.key is an arrow or Home/End
      const numpad = /^Numpad([0-9])$/.exec(e.code);
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (numpad) press(numpad[1]);
      else if (e.key === "Backspace" || e.key === "Delete") press("del");
      else if (e.key === "Escape" && onCancel) onCancel();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="pin-overlay" role="dialog" aria-label={title ?? "Enter PIN"}>
      <div className="pin-card">
        {onCancel && (
          <button className="icon-btn icon-btn-48 pin-close" aria-label="Close" onClick={onCancel}>
            <CloseIcon />
          </button>
        )}
        <h2 className="pin-title">
          {title ?? (mode === "set" ? (first === null ? "Choose a PIN" : "Confirm PIN") : "Enter PIN")}
        </h2>
        <div className="pin-dots" aria-label={`${digits.length} of 4 digits`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`pin-dot${i < digits.length ? " is-filled" : ""}`} />
          ))}
        </div>
        <p className="pin-message" role="status">
          {message}
        </p>
        <div className="pin-keys">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k, i) =>
            k ? (
              <button
                key={i}
                className="pin-key"
                onClick={() => press(k)}
                aria-label={k === "del" ? "Delete" : k}
              >
                {k === "del" ? "⌫" : k}
              </button>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
