"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { DEFAULT_CALENDAR_COLORS } from "@/lib/colors";
import type { Account, CalendarRow } from "@/lib/google";
import type { FamilyMember, Household, PhotoSource } from "@/lib/household";
import { PinPad } from "@/components/pin-pad";
import { ChevronIcon, CloseIcon } from "@/components/icons";
import { signOutFromSettings } from "./actions";

type SettingsData = {
  household: Household;
  accounts: Account[];
  calendars: CalendarRow[];
  members: { userId: string; email: string; addedAt: string }[];
  me: string;
};

export function Settings() {
  const router = useRouter();
  const [gate, setGate] = useState<"loading" | "set" | "check" | "open">("loading");
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<SettingsData>("/api/settings"));
      setGate("open");
    } catch (err) {
      if (err instanceof ApiError && err.code === "pin_required") setGate("check");
      else setError("Couldn't load settings.");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const cfg = await api<{ hasPin: boolean; pinUnlocked: boolean }>("/api/config");
      if (!cfg.hasPin) setGate("set");
      else if (!cfg.pinUnlocked) setGate("check");
      else await load();
    })().catch(() => setError("Couldn't load settings."));
  }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    setError("");
    try {
      const r = await api<{ household: Household }>("/api/settings", { method: "PATCH", body });
      setData((d) => (d ? { ...d, household: r.household } : d));
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? String(err.body.error ?? "Couldn't save.") : "Couldn't save.");
      if (err instanceof ApiError && err.code === "pin_required") setGate("check");
      return false;
    }
  };
  const action = async <T,>(body: Record<string, unknown>): Promise<T | null> => {
    setError("");
    try {
      return await api<T>("/api/settings", { body });
    } catch (err) {
      setError(
        err instanceof ApiError ? String(err.body.error ?? "Something went wrong.") : "Something went wrong.",
      );
      if (err instanceof ApiError && err.code === "pin_required") setGate("check");
      return null;
    }
  };

  // Cancelling "Change PIN" goes back to Settings; cancelling the first PIN or the unlock leaves.
  const cancel = () => (data ? setGate("open") : router.push("/"));
  if (gate === "set")
    return <PinPad mode="set" title="Choose a 4-digit PIN for Settings" onDone={load} onCancel={cancel} />;
  if (gate === "check") return <PinPad onDone={load} onCancel={() => router.push("/")} />;

  return (
    <main className="settings">
      <header className="settings-head">
        <Link href="/" className="btn btn-quiet">
          <ChevronIcon dir="left" size={20} /> Calendar
        </Link>
        <h1 className="settings-title">Settings</h1>
        <button
          className="btn btn-quiet"
          onClick={async () => {
            await api("/api/pin", { body: { action: "lock" } });
            router.push("/");
          }}
        >
          Lock
        </button>
      </header>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="settings-body">
          <GoogleSection data={data} setData={setData} action={action} />
          <PhotosSection sources={data.household.photoSources} patch={patch} action={action} />
          <WeatherSection household={data.household} patch={patch} />
          <FamilySection family={data.household.familyMembers} patch={patch} />
          <DisplaySection household={data.household} patch={patch} />
          <MembersSection data={data} setData={setData} action={action} />
          <section className="settings-card">
            <h2 className="settings-h2">Security</h2>
            <div className="row-actions">
              <button className="btn btn-quiet" onClick={() => setGate("set")}>
                Change PIN
              </button>
              <form action={signOutFromSettings}>
                <button className="btn btn-danger">Sign out of this display</button>
              </form>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

type Act = <T>(body: Record<string, unknown>) => Promise<T | null>;
type Patch = (body: Record<string, unknown>) => Promise<boolean>;

function GoogleSection({
  data,
  setData,
  action,
}: {
  data: SettingsData;
  setData: (f: (d: SettingsData | null) => SettingsData | null) => void;
  action: Act;
}) {
  const update = async (c: CalendarRow, change: { selected?: boolean; color?: string }) => {
    const r = await action<{ calendars: CalendarRow[] }>({
      action: "calendar",
      accountId: c.accountId,
      calendarId: c.calendarId,
      ...change,
    });
    if (r) setData((d) => (d ? { ...d, calendars: r.calendars } : d));
  };
  return (
    <section className="settings-card">
      <h2 className="settings-h2">Google accounts</h2>
      {data.accounts.map((a) => (
        <div key={a.id} className="account">
          <div className="account-head">
            {a.picture ? (
              <img className="avatar" src={a.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="avatar" />
            )}
            <div className="account-name">
              <strong>{a.name || a.email}</strong>
              <span className="muted">
                {a.email}
                {a.isFamily ? " · Family account" : ""}
              </span>
            </div>
            {a.status === "reconnect" ? (
              <a className="btn btn-primary" href={`/api/google/connect?hint=${encodeURIComponent(a.email)}`}>
                Reconnect
              </a>
            ) : (
              <span className="status-ok">Connected</span>
            )}
            <button
              className="btn btn-quiet"
              onClick={async () => {
                if (!window.confirm(`Remove ${a.email}? Its events disappear from the display.`)) return;
                const r = await action<{ accounts: Account[] }>({ action: "removeAccount", accountId: a.id });
                if (r)
                  setData((d) =>
                    d
                      ? {
                          ...d,
                          accounts: r.accounts,
                          calendars: d.calendars.filter((c) => c.accountId !== a.id),
                        }
                      : d,
                  );
              }}
            >
              Remove
            </button>
          </div>
          <ul className="cal-list">
            {data.calendars
              .filter((c) => c.accountId === a.id)
              .map((c) => (
                <li key={c.calendarId} className="cal-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={c.selected}
                      onChange={(e) => update(c, { selected: e.target.checked })}
                    />
                    <span>{c.summary}</span>
                    {c.accessRole !== "owner" && c.accessRole !== "writer" && (
                      <span className="muted"> · view only</span>
                    )}
                  </label>
                  <div className="swatches" role="radiogroup" aria-label={`Colour for ${c.summary}`}>
                    {DEFAULT_CALENDAR_COLORS.map((color) => (
                      <button
                        key={color}
                        role="radio"
                        aria-checked={c.color === color}
                        aria-label={color}
                        className={`swatch${c.color === color ? " is-on" : ""}`}
                        style={{ background: color }}
                        onClick={() => update(c, { color })}
                      />
                    ))}
                  </div>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <a className="btn btn-quiet" href="/api/google/connect">
        + Add Google account
      </a>
      <p className="field-hint">
        Tip: sharing a personal calendar with the family account (&ldquo;Make changes to events&rdquo;) works
        too, and needs no extra account here.
      </p>
    </section>
  );
}

function PhotosSection({ sources, patch, action }: { sources: PhotoSource[]; patch: Patch; action: Act }) {
  const [url, setUrl] = useState("");
  const [directOnly, setDirectOnly] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [newest, setNewest] = useState("");
  const [resolved, setResolved] = useState<PhotoSource | null>(null);
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    setBusy(true);
    setResolved(null);
    const r = await action<{ source: PhotoSource }>({ action: "resolvePhotos", url, directOnly });
    setBusy(false);
    if (r) setResolved(r.source);
  };
  const add = async () => {
    if (!resolved) return;
    const source = {
      ...resolved,
      keyword: keyword.trim() || undefined,
      newest: newest ? Number(newest) : undefined,
    };
    if (await patch({ photoSources: [...sources, source] })) {
      setUrl("");
      setResolved(null);
      setKeyword("");
      setNewest("");
    }
  };

  return (
    <section className="settings-card">
      <h2 className="settings-h2">Photos (SmugMug)</h2>
      <ul className="source-list">
        {sources.map((s, i) => (
          <li key={s.nodeId + i} className="source">
            <div>
              <strong>{s.name}</strong>
              <span className="muted">
                {" "}
                · {s.type === "Folder" ? `folder, ${s.galleryCount} galleries` : "gallery"} · {s.photoCount}{" "}
                photos
                {s.keyword ? ` · tagged “${s.keyword}”` : ""}
                {s.newest ? ` · newest ${s.newest}` : ""}
              </span>
            </div>
            <button
              className="icon-btn"
              aria-label={`Remove ${s.name}`}
              onClick={() => patch({ photoSources: sources.filter((_, j) => j !== i) })}
            >
              <CloseIcon size={20} />
            </button>
          </li>
        ))}
      </ul>
      <label className="field">
        <span className="field-label">Gallery or folder link</span>
        <input
          className="input"
          type="url"
          placeholder="https://<you>.smugmug.com/Folder/Gallery/n-…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={directOnly} onChange={(e) => setDirectOnly(e.target.checked)} />
        <span>For a folder, only galleries directly inside it</span>
      </label>
      <div className="two-col">
        <label className="field">
          <span className="field-label">Only photos tagged (optional)</span>
          <input
            className="input"
            placeholder="display"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Newest N (optional)</span>
          <input
            className="input"
            inputMode="numeric"
            value={newest}
            onChange={(e) => setNewest(e.target.value.replace(/\D/g, ""))}
          />
        </label>
      </div>
      <div className="row-actions">
        <button className="btn btn-quiet" onClick={resolve} disabled={!url || busy}>
          {busy ? "Checking…" : "Check link"}
        </button>
        {resolved && (
          <>
            <span>
              {resolved.name} ·{" "}
              {resolved.type === "Folder" ? `folder, ${resolved.galleryCount} galleries` : "gallery"} ·{" "}
              {resolved.photoCount} photos
            </span>
            <button className="btn btn-primary" onClick={add}>
              Add
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function WeatherSection({ household, patch }: { household: Household; patch: Patch }) {
  const [zip, setZip] = useState(household.weatherZip ?? "");
  return (
    <section className="settings-card">
      <h2 className="settings-h2">Weather</h2>
      <div className="row-actions">
        <label className="field">
          <span className="field-label">ZIP code</span>
          <input
            className="input input-zip"
            inputMode="numeric"
            maxLength={5}
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <button
          className="btn btn-primary"
          disabled={zip.length !== 5}
          onClick={() => patch({ weatherZip: zip })}
        >
          Save
        </button>
        {household.weatherPlace && <span className="place">{household.weatherPlace}</span>}
      </div>
      <div className="segmented" role="radiogroup" aria-label="Units">
        {(["F", "C"] as const).map((u) => (
          <button
            key={u}
            role="radio"
            aria-checked={household.units === u}
            className={household.units === u ? "is-on" : ""}
            onClick={() => patch({ units: u })}
          >
            °{u}
          </button>
        ))}
      </div>
    </section>
  );
}

function FamilySection({ family, patch }: { family: FamilyMember[]; patch: Patch }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <section className="settings-card">
      <h2 className="settings-h2">Family members</h2>
      <p className="field-hint">These appear as one-tap guest chips when adding an event.</p>
      <ul className="source-list">
        {family.map((f) => (
          <li key={f.email} className="source">
            <span>
              <strong>{f.name}</strong> <span className="muted">{f.email}</span>
            </span>
            <button
              className="icon-btn"
              aria-label={`Remove ${f.name}`}
              onClick={() => patch({ familyMembers: family.filter((x) => x.email !== f.email) })}
            >
              <CloseIcon size={20} />
            </button>
          </li>
        ))}
      </ul>
      <div className="two-col">
        <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="input"
          type="email"
          placeholder="Email"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <button
        className="btn btn-quiet"
        disabled={!name.trim() || !email.includes("@")}
        onClick={async () => {
          if (await patch({ familyMembers: [...family, { name, email }] })) {
            setName("");
            setEmail("");
          }
        }}
      >
        + Add family member
      </button>
    </section>
  );
}

function DisplaySection({ household, patch }: { household: Household; patch: Patch }) {
  const [keywords, setKeywords] = useState(household.outdoorKeywords.join(", "));
  const [rotation, setRotation] = useState(String(household.rotationSeconds));
  const [nightStart, setNightStart] = useState(household.nightStart);
  const [nightEnd, setNightEnd] = useState(household.nightEnd);
  return (
    <section className="settings-card">
      <h2 className="settings-h2">Display</h2>
      <label className="field">
        <span className="field-label">Outdoor keywords</span>
        <input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        <span className="field-hint">
          Events whose title starts a word with one of these get the Outdoor switch on.
        </span>
      </label>
      <div className="two-col">
        <label className="field">
          <span className="field-label">Photo change every (seconds)</span>
          <input
            className="input"
            inputMode="numeric"
            value={rotation}
            onChange={(e) => setRotation(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <div className="field">
          <span className="field-label">Night hours</span>
          <div className="two-col">
            <input
              className="input"
              type="time"
              aria-label="Night starts"
              value={nightStart}
              onChange={(e) => setNightStart(e.target.value)}
            />
            <input
              className="input"
              type="time"
              aria-label="Night ends"
              value={nightEnd}
              onChange={(e) => setNightEnd(e.target.value)}
            />
          </div>
        </div>
      </div>
      <button
        className="btn btn-primary"
        onClick={() =>
          patch({
            outdoorKeywords: keywords.split(","),
            rotationSeconds: Number(rotation),
            nightStart,
            nightEnd,
          })
        }
      >
        Save
      </button>
    </section>
  );
}

function MembersSection({
  data,
  setData,
  action,
}: {
  data: SettingsData;
  setData: (f: (d: SettingsData | null) => SettingsData | null) => void;
  action: Act;
}) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  return (
    <section className="settings-card">
      <h2 className="settings-h2">Who can sign in</h2>
      <ul className="source-list">
        {data.members.map((m) => (
          <li key={m.userId} className="source">
            <span>
              {m.email}
              {m.userId === data.me && <span className="muted"> · you</span>}
            </span>
            {m.userId !== data.me && (
              <button
                className="btn btn-quiet"
                onClick={async () => {
                  if (!window.confirm(`Remove ${m.email} from the family calendar?`)) return;
                  if (await action({ action: "removeMember", userId: m.userId })) {
                    setData((d) =>
                      d ? { ...d, members: d.members.filter((x) => x.userId !== m.userId) } : d,
                    );
                  }
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <input
          className="input"
          type="email"
          placeholder="Email to invite"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          className="btn btn-primary"
          disabled={!email.includes("@")}
          onClick={async () => {
            const r = await action<{ invited: boolean; email: string }>({ action: "invite", email });
            if (r) {
              setNote(
                r.invited
                  ? `Invitation sent to ${r.email}.`
                  : `${r.email} already has an account; they can sign in now (or use “Forgot password?”).`,
              );
              setEmail("");
              const fresh = await api<SettingsData>("/api/settings").catch(() => null);
              if (fresh) setData(() => fresh);
            }
          }}
        >
          Invite
        </button>
      </div>
      {note && <p className="field-hint">{note}</p>}
    </section>
  );
}
