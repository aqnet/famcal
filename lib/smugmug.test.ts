import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoSource } from "./household";

vi.mock("@/lib/household", () => ({
  getHousehold: vi.fn(),
  getCache: vi.fn(async () => null),
  setCache: vi.fn(async () => undefined),
}));
const household = await import("./household");
const { getPhotos, resolveSource, SmugMugError } = await import("./smugmug");

// A small SmugMug: a "Family" folder holding the "Summer" album and a "Trips" sub-folder with "Hawaii".
const node = (NodeID: string, Name: string, Type: string, uris: object) => ({
  NodeID,
  Name,
  Type,
  Uris: uris,
});
const img = (key: string, over: object = {}) => ({
  ImageKey: key,
  ThumbnailUrl: `https://photos.smugmug.com/x/Th/i-${key}-Th.jpg`,
  OriginalWidth: 3000,
  OriginalHeight: 2000,
  ...over,
});
const API: Record<string, unknown> = {
  "/api/v2/node/Family": {
    Node: node("Family", "Family", "Folder", { ChildNodes: { Uri: "/api/v2/node/Family!children" } }),
  },
  "/api/v2/node/Family!children": {
    Node: [
      node("Summer", "Summer", "Album", { Album: { Uri: "/api/v2/album/summer" } }),
      node("Trips", "Trips", "Folder", { ChildNodes: { Uri: "/api/v2/node/Trips!children" } }),
      node("About", "About", "Page", {}),
    ],
  },
  "/api/v2/node/Trips!children": {
    Node: [node("Hawaii", "Hawaii", "Album", { Album: { Uri: "/api/v2/album/hawaii" } })],
  },
  "/api/v2/album/summer!images": {
    AlbumImage: [
      img("s1", { KeywordArray: ["Beach"], DateTimeOriginal: "2026-07-01T10:00:00" }),
      img("s2", { Caption: "Fireworks", DateTimeOriginal: "2026-07-04T21:00:00" }),
      img("video", { IsVideo: true }),
    ],
  },
  "/api/v2/album/hawaii!images": {
    AlbumImage: [
      img("h1", { Keywords: "beach; sunset", DateTimeOriginal: "2025-12-20T10:00:00" }),
      img("s1"),
    ],
  },
};

const fetchMock = vi.fn(async (url: URL | string) => {
  const u = new URL(String(url));
  if (u.searchParams.get("APIKey") !== "key") return new Response("", { status: 401 });
  const body = API[u.pathname];
  return body ? new Response(JSON.stringify({ Response: body })) : new Response("", { status: 404 });
});

const source = (over: Partial<PhotoSource> = {}): PhotoSource => ({
  url: "https://x.smugmug.com/Family",
  nodeId: "Family",
  name: "Family",
  type: "Folder",
  directOnly: false,
  galleryCount: 2,
  photoCount: 4,
  ...over,
});
const withSources = (...photoSources: PhotoSource[]) =>
  vi.mocked(household.getHousehold).mockResolvedValue({ photoSources } as never);

beforeEach(() => {
  process.env.SMUGMUG_API_KEY = "key";
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("getPhotos (FR-23, FR-28)", () => {
  it("collects photos from every album under a folder, skipping videos and repeats", async () => {
    withSources(source());
    const { photos, failed } = await getPhotos();
    expect(failed).toBe(false);
    expect(photos.map((p) => p.key).sort()).toEqual(["h1", "s1", "s2"]);
    const s2 = photos.find((p) => p.key === "s2")!;
    expect(s2).toMatchObject({ caption: "Fireworks", width: 3000, height: 2000 });
    expect(s2.url).toContain("/L/");
    expect(s2.heroUrl).toContain("/XL/");
  });

  it("can stay in the folder's own albums", async () => {
    withSources(source({ directOnly: true }));
    expect((await getPhotos()).photos.map((p) => p.key).sort()).toEqual(["s1", "s2"]);
  });

  it("filters by keyword (either SmugMug field, any case) and keeps the newest N", async () => {
    withSources(source({ keyword: "BEACH" }));
    expect((await getPhotos()).photos.map((p) => p.key).sort()).toEqual(["h1", "s1"]);
    withSources(source({ newest: 1 }));
    expect((await getPhotos()).photos.map((p) => p.key)).toEqual(["s2"]);
  });

  it("serves a fresh cached list without calling SmugMug", async () => {
    withSources(source());
    vi.mocked(household.getCache).mockResolvedValueOnce({ value: [{ key: "cached" }], fresh: true });
    expect((await getPhotos()).photos).toEqual([{ key: "cached" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches a new list for an hour", async () => {
    withSources(source());
    await getPhotos();
    expect(household.setCache).toHaveBeenCalledWith(
      expect.stringMatching(/^photos:Family\//),
      expect.any(Array),
      3600,
    );
  });

  it("keeps showing the last list when SmugMug fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    withSources(source({ nodeId: "Missing" }));
    vi.mocked(household.getCache).mockResolvedValueOnce({ value: [{ key: "old" }], fresh: false });
    expect(await getPhotos()).toEqual({ photos: [{ key: "old" }], failed: true });
  });
});

describe("resolveSource (FR-29)", () => {
  it("counts a folder's galleries and photos", async () => {
    const s = await resolveSource("https://x.smugmug.com/n-Family", false);
    expect(s).toMatchObject({ nodeId: "Family", type: "Folder", galleryCount: 2, photoCount: 4 });
  });

  it("explains links it can't use", async () => {
    await expect(resolveSource("https://example.com/photos", false)).rejects.toThrow("isn't a SmugMug");
    process.env.SMUGMUG_API_KEY = "wrong";
    await expect(resolveSource("https://x.smugmug.com/n-Family", false)).rejects.toThrow(/private/);
    process.env.SMUGMUG_API_KEY = "key";
    await expect(resolveSource("https://x.smugmug.com/n-Nope", false)).rejects.toBeInstanceOf(SmugMugError);
  });
});
