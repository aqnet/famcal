export function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// "9 AM", "9:30 AM"
export function fmtTimeShort(d: Date): string {
  return d.getMinutes() ? fmtTime(d) : d.toLocaleTimeString("en-US", { hour: "numeric" });
}

export function fmtHour(h: number): string {
  return `${h % 12 || 12} ${h < 12 || h === 24 ? "AM" : "PM"}`;
}

export function fmtDateLong(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function age(fromIso: string, now: Date): string {
  const mins = Math.round((now.getTime() - Date.parse(fromIso)) / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0].replace(/[._-]+/g, " ") : nameOrEmail;
  const parts = base.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}

// Message for the ?google= status the OAuth callback redirects with; null when there's nothing to say.
export function googleStatusText(status: string | undefined): { text: string; error: boolean } | null {
  switch (status) {
    case undefined:
      return null;
    case "connected":
      return { text: "Google account connected.", error: false };
    case "denied":
      return { text: "Google access was not granted.", error: true };
    case "api-disabled":
      return {
        text: "Google Calendar API is turned off for this app's Google Cloud project. Enable it, then connect again.",
        error: true,
      };
    case "auth":
      return { text: "Google sign-in didn't complete. Try connecting again.", error: true };
    case "state":
      return { text: "The Google sign-in expired. Try connecting again.", error: true };
    default:
      return { text: "Couldn't connect Google. Try again.", error: true };
  }
}
