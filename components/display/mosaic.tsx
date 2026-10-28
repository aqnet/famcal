"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { layoutChoices, MOSAIC_WIDTH, type MosaicLayout, type Rect } from "@/lib/mosaic-layout";
import { reducedMotion } from "./hooks";
import type { Photo } from "./types";

// Each tile gets a photo of about its own shape; with 3:2 and 2:3 tiles (lib/mosaic-layout) a photo
// of the right orientation fills its tile uncropped.
const misfit = (p: Photo, ratio: number) => Math.abs(Math.log(p.width / p.height / ratio));

// A random photo among the ones that fit the tile about as well as the best one. A photo of the other
// orientation is used only when none of the right one is free.
function pick(photos: Photo[], ratio: number, exclude: Set<string>): Photo | null {
  const pool = photos
    .filter((p) => !exclude.has(p.key))
    .map((p) => ({ p, d: misfit(p, ratio) }))
    .sort((a, b) => a.d - b.d);
  if (!pool.length) return null;
  const close = pool.filter((c) => c.d <= pool[0].d + 0.2);
  return close[Math.floor(Math.random() * close.length)].p;
}

const GAP = 4; // px between tiles

// Big tiles (the hero, the PLL portrait) load the larger rendition so they stay sharp.
const isBig = (r: Rect) => Math.max(r.w, r.h) >= 4;

// Where a tile sits, in % of the mosaic, less half the gap on each inner edge.
function place(r: Rect, height: number): React.CSSProperties {
  const half = GAP / 2;
  const l = r.x > 0 ? half : 0;
  const rt = r.x + r.w < MOSAIC_WIDTH - 1e-6 ? half : 0;
  const t = r.y > 0 ? half : 0;
  const b = r.y + r.h < height - 1e-6 ? half : 0;
  return {
    left: `calc(${(r.x / MOSAIC_WIDTH) * 100}% + ${l}px)`,
    top: `calc(${(r.y / height) * 100}% + ${t}px)`,
    width: `calc(${(r.w / MOSAIC_WIDTH) * 100}% - ${l + rt}px)`,
    height: `calc(${(r.h / height) * 100}% - ${t + b}px)`,
  };
}

// Each tile is a two-sided card. A new photo loads on the hidden face, then the card turns over;
// `turns` only grows, so every flip keeps spinning the same way.
type Tile = { faces: [Photo | null, Photo | null]; turns: number; loading: boolean };
const front = (t: Tile) => t.faces[t.turns % 2];

// One layout on screen; while it changes, the old one slides up and out as the new one slides in.
type Layer = { id: number; layout: MosaicLayout; avoid: string[]; leaving: boolean };

export function Mosaic({
  photos,
  rotationSeconds,
  caption,
  onOpen,
}: {
  photos: Photo[];
  rotationSeconds: number;
  caption: string;
  onOpen: (p: Photo) => void;
}) {
  // The layouts that suit the space the mosaic gets (device, orientation) and the gallery's mix,
  // measured before first paint. A tile shows a photo of its own orientation.
  const box = useRef<HTMLDivElement>(null);
  const choices = useRef<MosaicLayout[]>([]);
  const nextId = useRef(0);
  const [layers, setLayers] = useState<Layer[]>([]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const portrait = photos.filter((p) => p.height > p.width).length;
    const mix = { portrait, landscape: photos.length - portrait };
    const measure = () => {
      if (!el.clientWidth || !el.clientHeight) return;
      choices.current = layoutChoices(el.clientWidth, el.clientHeight, mix);
      // Keep the current layout while it still suits the space; otherwise slide in the best one for
      // the new shape (or just show it, the first time).
      setLayers((prev) => {
        const cur = prev.find((l) => !l.leaving);
        if (cur && choices.current.some((c) => c.name === cur.layout.name)) return prev;
        const next = { id: nextId.current++, layout: choices.current[0], avoid: [], leaving: false };
        return !cur || reducedMotion() ? [next] : [{ ...cur, leaving: true }, next];
      });
    };
    measure();
    // While the space is animating (the month folding away, a rotation) the tiles just stretch with
    // it; the layout is re-chosen once the size has settled.
    let settle: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(settle);
      settle = setTimeout(measure, 150);
    });
    ro.observe(el);
    return () => {
      clearTimeout(settle);
      ro.disconnect();
    };
  }, [photos]);

  // Every photo on screen has changed over: slide in another layout, with photos not just shown.
  const cycle = (shown: string[]) =>
    setLayers((prev) => {
      const cur = prev.find((l) => !l.leaving);
      const others = choices.current.filter((c) => c.name !== cur?.layout.name);
      if (!cur || !others.length) return prev;
      const next = {
        id: nextId.current++,
        layout: others[Math.floor(Math.random() * others.length)],
        avoid: shown,
        leaving: false,
      };
      return reducedMotion() ? [next] : [{ ...cur, leaving: true }, next];
    });
  const gone = (id: number) => setLayers((prev) => prev.filter((l) => l.id !== id));

  return (
    <section className="mosaic-wrap" aria-label="Photos">
      <div className="mosaic" ref={box}>
        {layers.map((l) => (
          <div
            key={l.id}
            className={`mosaic-layer${l.leaving ? " is-leaving" : layers.length > 1 ? " is-entering" : ""}`}
            onAnimationEnd={(e) => l.leaving && e.target === e.currentTarget && gone(l.id)}
            aria-hidden={l.leaving || undefined}
          >
            <Tiles
              layout={l.layout}
              photos={photos}
              avoid={l.avoid}
              rotationSeconds={rotationSeconds}
              paused={l.leaving}
              onOpen={onOpen}
              onCycle={cycle}
            />
          </div>
        ))}
      </div>
      <div className="mosaic-caption">
        {caption ? `SmugMug · ${caption}` : "Add a SmugMug gallery in Settings"}
      </div>
    </section>
  );
}

function Tiles({
  layout,
  photos,
  avoid,
  rotationSeconds,
  paused,
  onOpen,
  onCycle,
}: {
  layout: MosaicLayout;
  photos: Photo[];
  avoid: string[]; // photos the previous layout showed: used only if nothing else fits
  rotationSeconds: number;
  paused: boolean;
  onOpen: (p: Photo) => void;
  onCycle: (shown: string[]) => void;
}) {
  const [tiles, setTiles] = useState<Tile[]>(() => {
    const used = new Set<string>();
    const fresh = new Set(avoid);
    return layout.tiles.map((r) => {
      const p = pick(photos, r.w / r.h, fresh) ?? pick(photos, r.w / r.h, used);
      if (p) {
        used.add(p.key);
        fresh.add(p.key);
      }
      return { faces: [p, null], turns: 0, loading: false };
    });
  });
  const turn = useRef(0);
  const latest = useRef(tiles);
  useEffect(() => {
    latest.current = tiles;
  }, [tiles]);
  const cycleRef = useRef(onCycle);
  useEffect(() => {
    cycleRef.current = onCycle;
  }, [onCycle]);

  // Swap one tile at a time: every rotationSeconds, and all of them in turn every 10 minutes (FR-22).
  // Once every tile has changed over, the next tick changes the layout instead.
  useEffect(() => {
    const count = layout.tiles.length;
    if (paused || photos.length <= count) return;
    const swap = (i: number) =>
      setTiles((prev) => {
        const used = new Set(prev.flatMap((t) => t.faces.map((p) => p?.key)).filter(Boolean) as string[]);
        const r = layout.tiles[i];
        const p = pick(photos, r.w / r.h, used);
        if (!p || prev[i].loading) return prev;
        return prev.map((t, j) => {
          if (j !== i) return t;
          const faces: Tile["faces"] = [...t.faces];
          faces[(t.turns + 1) % 2] = p;
          return { ...t, faces, loading: true };
        });
      });
    const every = setInterval(() => {
      const now = latest.current;
      if (now.every((t) => t.turns > 0 && !t.loading)) {
        cycleRef.current(now.map((t) => front(t)?.key).filter(Boolean) as string[]);
        return;
      }
      swap(turn.current % count);
      turn.current++;
    }, rotationSeconds * 1000);
    const repick = setInterval(() => {
      for (let i = 0; i < count; i++) setTimeout(() => swap(i), i * 1500);
    }, 10 * 60_000);
    return () => {
      clearInterval(every);
      clearInterval(repick);
    };
  }, [layout, photos, rotationSeconds, paused]);

  // The hidden face finished loading (or failed): turn the card over, or stay put.
  const loaded = (i: number, ok: boolean) =>
    setTiles((prev) =>
      prev.map((t, j) =>
        j === i && t.loading ? { ...t, loading: false, turns: t.turns + (ok ? 1 : 0) } : t,
      ),
    );

  return tiles.map((t, i) => {
    const shown = front(t);
    const r = layout.tiles[i];
    return (
      <button
        key={i}
        className="tile"
        style={place(r, layout.height)}
        onClick={() => shown && onOpen(shown)}
        aria-label={shown?.caption || "Open photo"}
        disabled={!shown}
      >
        <span className="tile-card" style={{ transform: `rotateY(${t.turns * 180}deg)` }}>
          {t.faces.map((p, f) =>
            p ? (
              <img
                key={f}
                src={isBig(r) ? p.heroUrl : p.url}
                alt=""
                draggable={false}
                className={`tile-face tile-face-${f}`}
                onLoad={() => f !== t.turns % 2 && loaded(i, true)}
                onError={() => f !== t.turns % 2 && loaded(i, false)}
              />
            ) : null,
          )}
        </span>
      </button>
    );
  });
}
