// The photo mosaic is a stack of full-width bands whose tiles are exactly 3:2 or 2:3, the shapes
// family photos come in, so a photo of the right orientation fills its tile with no cropping. Which
// bands to stack depends on the space the screen leaves for the mosaic (visualdesign.md → Photo mosaic).

export type Rect = { x: number; y: number; w: number; h: number }; // units; the mosaic is 6 wide
export type MosaicLayout = { name: string; height: number; tiles: Rect[] };

export const MOSAIC_WIDTH = 6;

// A portrait beside two stacked landscapes, all exact: L is b × 2b/3, so the band is 4b/3 tall and the
// portrait 8b/9 wide; with b + 8b/9 = 6, b = 54/17.
const B = 54 / 17;
const A = MOSAIC_WIDTH - B;
const PLL_H = (4 * B) / 3;

const BANDS: { name: string; height: number; tiles: Rect[] }[] = [
  { name: "H", height: 4, tiles: [{ x: 0, y: 0, w: 6, h: 4 }] },
  {
    name: "LL",
    height: 2,
    tiles: [
      { x: 0, y: 0, w: 3, h: 2 },
      { x: 3, y: 0, w: 3, h: 2 },
    ],
  },
  {
    name: "PLL",
    height: PLL_H,
    tiles: [
      { x: 0, y: 0, w: A, h: PLL_H },
      { x: A, y: 0, w: B, h: PLL_H / 2 },
      { x: A, y: PLL_H / 2, w: B, h: PLL_H / 2 },
    ],
  },
  {
    name: "LLP",
    height: PLL_H,
    tiles: [
      { x: 0, y: 0, w: B, h: PLL_H / 2 },
      { x: 0, y: PLL_H / 2, w: B, h: PLL_H / 2 },
      { x: B, y: 0, w: A, h: PLL_H },
    ],
  },
  {
    name: "PPP",
    height: 3,
    tiles: [
      { x: 0, y: 0, w: 2, h: 3 },
      { x: 2, y: 0, w: 2, h: 3 },
      { x: 4, y: 0, w: 2, h: 3 },
    ],
  },
];

const IDEAL_TILES = 5;

type Mix = { portrait: number; landscape: number };
const ANY: Mix = { portrait: Infinity, landscape: Infinity };

// Every stack of up to four bands, best first. A stack scores by how close its shape is to the space,
// with a small pull toward about five tiles (fewer looks sparse, more makes every photo small) and
// toward the gallery's mix: a tile needs a photo of its orientation, ideally with spares so rotation
// has something to show. Any leftover difference is absorbed by stretching, a light crop shared by
// every tile.
type Ranked = { cost: number; stretch: number; layout: MosaicLayout };

function rank(width: number, height: number, photos: Mix): Ranked[] {
  const target = (MOSAIC_WIDTH * height) / width; // the stack height, in units, that fills the space
  const out: Ranked[] = [];
  const walk = (stack: typeof BANDS) => {
    if (stack.length) {
      const h = stack.reduce((s, b) => s + b.height, 0);
      const tiles = stack.flatMap((b) => b.tiles);
      const portrait = tiles.filter((t) => t.h > t.w).length;
      const landscape = tiles.length - portrait;
      const short = (want: number, have: number) =>
        Math.max(0, want - have) + 0.1 * Math.max(0, want - have / 2);
      const stretch = Math.abs(Math.log(h / target));
      const cost =
        stretch +
        0.06 * Math.abs(tiles.length - IDEAL_TILES) +
        0.5 * (short(portrait, photos.portrait) + short(landscape, photos.landscape));
      out.push({ cost, stretch, layout: build(stack) });
    }
    if (stack.length === 4) return;
    // The same band twice in a row only for LL (a 2×2 grid); H+H or PPP+PPP look like a mistake.
    for (const b of BANDS) if (stack.at(-1) !== b || b.name === "LL") walk([...stack, b]);
  };
  walk([]);
  // Stable: among equal costs the first enumerated (simplest) stack wins.
  return out.sort((a, b) => a.cost - b.cost);
}

function build(stack: typeof BANDS): MosaicLayout {
  let y = 0;
  const tiles: Rect[] = [];
  for (const band of stack) {
    for (const t of band.tiles) tiles.push({ ...t, y: t.y + y });
    y += band.height;
  }
  return { name: stack.map((b) => b.name).join("+"), height: y, tiles };
}

// The best layout for the space.
export function chooseLayout(width: number, height: number, photos: Mix = ANY): MosaicLayout {
  return rank(width, height, photos)[0].layout;
}

// Layouts nearly as good as the best, best first, for the mosaic to cycle through: the same exact
// 3:2 and 2:3 tiles, rearranged. None stretches its tiles more than ~12% (or than the best one has
// to), so photos keep their shape. Always includes the best one.
export function layoutChoices(width: number, height: number, photos: Mix = ANY): MosaicLayout[] {
  const all = rank(width, height, photos);
  const maxStretch = Math.max(0.12, all[0].stretch);
  return all.filter((c) => c.cost <= all[0].cost + 0.1 && c.stretch <= maxStretch).map((c) => c.layout);
}
