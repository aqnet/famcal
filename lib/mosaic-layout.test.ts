import { describe, expect, it } from "vitest";
import { chooseLayout, layoutChoices, MOSAIC_WIDTH } from "./mosaic-layout";

const ratio = (t: { w: number; h: number }) => t.w / t.h;

describe("chooseLayout", () => {
  it("uses only exact 3:2 and 2:3 tiles", () => {
    for (const [w, h] of [
      [444, 482],
      [387, 304],
      [376, 826],
      [376, 660],
    ]) {
      for (const t of chooseLayout(w, h).tiles) {
        const r = ratio(t);
        expect(Math.min(Math.abs(r - 1.5), Math.abs(r - 2 / 3))).toBeLessThan(1e-9);
      }
    }
  });

  it("tiles the whole mosaic with no overlap", () => {
    const l = chooseLayout(444, 482);
    const area = l.tiles.reduce((s, t) => s + t.w * t.h, 0);
    expect(area).toBeCloseTo(MOSAIC_WIDTH * l.height, 9);
    for (const t of l.tiles) {
      expect(t.x + t.w).toBeLessThanOrEqual(MOSAIC_WIDTH + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(l.height + 1e-9);
    }
  });

  it("fits the iPad Pro landscape mosaics within a few percent, with five tiles", () => {
    for (const [w, h] of [
      [444, 482], // 13"
      [387, 304], // 11"
    ]) {
      const l = chooseLayout(w, h);
      expect(l.tiles).toHaveLength(5);
      expect(Math.abs(Math.log(MOSAIC_WIDTH / l.height / (w / h)))).toBeLessThan(0.07);
    }
  });

  it("keeps portrait tiles to what the gallery can fill, with spares to rotate", () => {
    const mix = { portrait: 2, landscape: 15 };
    for (const [w, h] of [
      [444, 482],
      [387, 304],
      [376, 826],
      [376, 660],
    ]) {
      const portraits = chooseLayout(w, h, mix).tiles.filter((t) => t.h > t.w).length;
      expect(portraits).toBeLessThanOrEqual(1);
    }
  });

  it("offers other layouts to cycle through, best first, all keeping their tiles' shape", () => {
    for (const mix of [
      { portrait: 2, landscape: 15 },
      { portrait: 8, landscape: 20 },
    ]) {
      for (const [w, h] of [
        [444, 482],
        [387, 304],
        [376, 826],
        [376, 660],
      ]) {
        const choices = layoutChoices(w, h, mix);
        expect(choices[0].name).toBe(chooseLayout(w, h, mix).name);
        expect(choices.length).toBeGreaterThanOrEqual(2);
        const best = Math.abs(Math.log(MOSAIC_WIDTH / choices[0].height / (w / h)));
        for (const c of choices) {
          const stretch = Math.abs(Math.log(MOSAIC_WIDTH / c.height / (w / h)));
          expect(stretch).toBeLessThanOrEqual(Math.max(0.12, best) + 1e-9);
        }
      }
    }
  });
});
