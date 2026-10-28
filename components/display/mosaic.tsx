"use client";

import { useEffect, useRef, useState } from "react";
import type { Photo } from "./types";

// Tile shapes in grid order: hero, tall, square, tall, square (visualdesign.md → Photo mosaic).
const SHAPES = ["wide", "tall", "square", "tall", "square"] as const;
type Shape = (typeof SHAPES)[number];

const fits = (p: Photo, shape: Shape) =>
  shape === "wide" ? p.width > p.height * 1.15 : shape === "tall" ? p.height > p.width * 1.1 : true;

function pick(photos: Photo[], shape: Shape, exclude: Set<string>): Photo | null {
  const pool = photos.filter((p) => !exclude.has(p.key));
  const matching = pool.filter((p) => fits(p, shape));
  const from = matching.length ? matching : pool;
  return from.length ? from[Math.floor(Math.random() * from.length)] : null;
}

type Tile = { current: Photo | null; next: Photo | null; showNext: boolean };

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
  // The parent remounts this component (key) when the photo list changes, so tiles start fresh.
  const [tiles, setTiles] = useState<Tile[]>(() => {
    const used = new Set<string>();
    return SHAPES.map((shape) => {
      const p = pick(photos, shape, used);
      if (p) used.add(p.key);
      return { current: p, next: null, showNext: false };
    });
  });
  const turn = useRef(0);

  // Swap one tile at a time: every rotationSeconds, and all five in turn every 10 minutes (FR-22).
  useEffect(() => {
    if (photos.length < 6) return;
    const swap = (i: number) =>
      setTiles((prev) => {
        const used = new Set(prev.flatMap((t) => [t.current?.key, t.next?.key]).filter(Boolean) as string[]);
        const p = pick(photos, SHAPES[i], used);
        if (!p) return prev;
        const img = new Image();
        img.src = i === 0 ? p.heroUrl : p.url;
        return prev.map((t, j) => (j === i ? { ...t, next: p, showNext: false } : t));
      });
    const every = setInterval(() => {
      swap(turn.current % SHAPES.length);
      turn.current++;
    }, rotationSeconds * 1000);
    const repick = setInterval(() => {
      SHAPES.forEach((_, i) => setTimeout(() => swap(i), i * 1500));
    }, 10 * 60_000);
    return () => {
      clearInterval(every);
      clearInterval(repick);
    };
  }, [photos, rotationSeconds]);

  const loaded = (i: number) =>
    setTiles((prev) => prev.map((t, j) => (j === i && t.next ? { ...t, showNext: true } : t)));
  const settled = (i: number) =>
    setTiles((prev) =>
      prev.map((t, j) =>
        j === i && t.next && t.showNext ? { current: t.next, next: null, showNext: false } : t,
      ),
    );

  return (
    <section className="mosaic-wrap" aria-label="Photos">
      <div className="mosaic">
        {tiles.map((t, i) => (
          <button
            key={i}
            className={`tile tile-${i + 1}`}
            onClick={() => t.current && onOpen(t.current)}
            aria-label={t.current?.caption || "Open photo"}
            disabled={!t.current}
          >
            {t.current && <img src={i === 0 ? t.current.heroUrl : t.current.url} alt="" draggable={false} />}
            {t.next && (
              <img
                src={i === 0 ? t.next.heroUrl : t.next.url}
                alt=""
                draggable={false}
                className={`tile-next${t.showNext ? " is-shown" : ""}`}
                onLoad={() => loaded(i)}
                onTransitionEnd={() => settled(i)}
              />
            )}
          </button>
        ))}
      </div>
      <div className="mosaic-caption">
        {caption ? `SmugMug · ${caption}` : "Add a SmugMug gallery in Settings"}
      </div>
    </section>
  );
}
