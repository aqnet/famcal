import type { IconKind } from "@/lib/weather-model";

type P = { size?: number; className?: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function CloseIcon({ size = 24 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

const CHEVRON = { left: "M15 5l-7 7 7 7", right: "M9 5l7 7-7 7", up: "M5 15l7-7 7 7", down: "M5 9l7 7 7-7" };

export function ChevronIcon({ size = 24, dir }: P & { dir: keyof typeof CHEVRON }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke}>
      <path d={CHEVRON[dir]} />
    </svg>
  );
}

export function PlusIcon({ size = 22 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke} strokeWidth={2.5}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function GearIcon({ size = 22 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

// Weather icons: sun #C98A00, cloud --text-3, rain --rain (visualdesign.md).
export function WeatherIcon({ kind, size = 40 }: P & { kind: IconKind }) {
  const sun = (
    <g stroke="#C98A00" fill="none" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </g>
  );
  const cloud = (dy = 0) => (
    <path
      d={`M7 ${18 + dy}h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.6A3.3 3.3 0 0 0 7 ${18 + dy}z`}
      fill="none"
      stroke="var(--text-3)"
      strokeWidth={2}
      strokeLinejoin="round"
    />
  );
  const drops = (
    <path
      d="M8 19.5l-1 2.5M12 19.5l-1 2.5M16 19.5l-1 2.5"
      stroke="var(--rain)"
      strokeWidth={2}
      strokeLinecap="round"
    />
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {kind === "sun" && sun}
      {kind === "partly" && (
        <>
          <g transform="translate(-3 -3) scale(.8)">{sun}</g>
          {cloud(1)}
        </>
      )}
      {kind === "cloud" && cloud(1)}
      {kind === "fog" && (
        <>
          {cloud(-2)}
          <path d="M5 20h14M7 22.5h10" stroke="var(--text-3)" strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      {kind === "rain" && (
        <>
          {cloud(-2)}
          {drops}
        </>
      )}
      {kind === "snow" && (
        <>
          {cloud(-2)}
          <path
            d="M8 20.5h.01M12 21.5h.01M16 20.5h.01"
            stroke="var(--text-3)"
            strokeWidth={3}
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "storm" && (
        <>
          {cloud(-2)}
          <path
            d="M12.5 17l-2 3.5h3l-2 3"
            fill="none"
            stroke="#C98A00"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}
