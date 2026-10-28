import "server-only";
import { env } from "@/lib/env";
import { getCache, getHousehold, setCache, type PhotoSource } from "@/lib/household";
import { parseSmugMugUrl, sizedUrl } from "@/lib/smugmug-url";

// Read-only SmugMug API v2 with an API key (public or unlisted galleries). Private galleries
// (OAuth 1.0a) are not wired up yet. Response shapes are confirmed in the Phase 0 spike.
const API = "https://api.smugmug.com";

export class SmugMugError extends Error {}

async function smug<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(path.startsWith("/api/") ? API + path : `${API}/api/v2${path}`);
  url.searchParams.set("APIKey", env("SMUGMUG_API_KEY"));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (res.status === 401 || res.status === 403)
    throw new SmugMugError("This gallery is private. Make it Unlisted, or connect SmugMug with OAuth.");
  if (res.status === 404) throw new SmugMugError("SmugMug couldn't find that gallery or folder.");
  if (!res.ok) throw new SmugMugError(`SmugMug error ${res.status}`);
  return ((await res.json()) as { Response: T }).Response;
}

type Node = {
  NodeID: string;
  Name: string;
  Type: "Album" | "Folder" | "Page" | string;
  Uris: { Album?: { Uri: string }; ChildNodes?: { Uri: string } };
};

type AlbumImage = {
  ImageKey: string;
  Title?: string;
  Caption?: string;
  FileName?: string;
  IsVideo?: boolean;
  OriginalWidth?: number;
  OriginalHeight?: number;
  ThumbnailUrl: string;
  KeywordArray?: string[];
  Keywords?: string;
  DateTimeOriginal?: string;
  Date?: string;
};

export type Photo = {
  key: string;
  url: string; // tile size
  heroUrl: string;
  fullUrl: string;
  caption: string;
  takenAt: string | null;
  width: number;
  height: number;
};

async function nodeFromUrl(input: string): Promise<Node> {
  const parsed = parseSmugMugUrl(input);
  if (!parsed) throw new SmugMugError("That isn't a SmugMug gallery or folder link.");
  if (parsed.nodeId) return (await smug<{ Node: Node }>(`/node/${parsed.nodeId}`)).Node;
  const found = await smug<{
    Node?: Node;
    Album?: { Uris: { Node?: { Uri: string } } };
    Folder?: { Uris: { Node?: { Uri: string } } };
  }>(`/user/${parsed.owner}!urlpathlookup`, { urlpath: parsed.path });
  if (found.Node) return found.Node;
  const nodeUri = found.Album?.Uris.Node?.Uri ?? found.Folder?.Uris.Node?.Uri;
  if (!nodeUri) throw new SmugMugError("SmugMug couldn't find that gallery or folder.");
  return (await smug<{ Node: Node }>(nodeUri)).Node;
}

async function childNodes(node: Node): Promise<Node[]> {
  if (!node.Uris.ChildNodes) return [];
  const out: Node[] = [];
  for (let start = 1; start < 2000; start += 100) {
    const page = await smug<{ Node?: Node[] }>(node.Uris.ChildNodes.Uri, {
      start: String(start),
      count: "100",
    });
    out.push(...(page.Node ?? []));
    if ((page.Node?.length ?? 0) < 100) break;
  }
  return out;
}

// Albums under a node: itself if it's a gallery; galleries beneath it if it's a folder (FR-28).
async function albumsUnder(node: Node, directOnly: boolean): Promise<{ albumUri: string; name: string }[]> {
  if (node.Type === "Album")
    return node.Uris.Album ? [{ albumUri: node.Uris.Album.Uri, name: node.Name }] : [];
  if (node.Type !== "Folder") return [];
  const albums: { albumUri: string; name: string }[] = [];
  const queue: { node: Node; depth: number }[] = [{ node, depth: 0 }];
  while (queue.length && albums.length < 100) {
    const { node: current, depth } = queue.shift()!;
    for (const child of await childNodes(current)) {
      if (child.Type === "Album" && child.Uris.Album)
        albums.push({ albumUri: child.Uris.Album.Uri, name: child.Name });
      else if (child.Type === "Folder" && !directOnly && depth < 5)
        queue.push({ node: child, depth: depth + 1 });
    }
  }
  return albums;
}

async function albumImages(albumUri: string): Promise<AlbumImage[]> {
  const out: AlbumImage[] = [];
  for (let start = 1; start < 5000; start += 100) {
    const page = await smug<{ AlbumImage?: AlbumImage[] }>(`${albumUri}!images`, {
      start: String(start),
      count: "100",
    });
    out.push(...(page.AlbumImage ?? []));
    if ((page.AlbumImage?.length ?? 0) < 100) break;
  }
  return out;
}

// Resolve a pasted URL and report what it points to (FR-29).
export async function resolveSource(url: string, directOnly: boolean): Promise<PhotoSource> {
  const node = await nodeFromUrl(url);
  if (node.Type !== "Album" && node.Type !== "Folder")
    throw new SmugMugError("That link is a page, not a gallery or folder.");
  const albums = await albumsUnder(node, directOnly);
  let photoCount = 0;
  for (const a of albums) photoCount += (await albumImages(a.albumUri)).filter((i) => !i.IsVideo).length;
  return {
    url,
    nodeId: node.NodeID,
    name: node.Name,
    type: node.Type,
    directOnly,
    galleryCount: albums.length,
    photoCount,
  };
}

function toPhoto(img: AlbumImage): Photo {
  return {
    key: img.ImageKey,
    url: sizedUrl(img.ThumbnailUrl, "L"),
    heroUrl: sizedUrl(img.ThumbnailUrl, "XL"),
    fullUrl: sizedUrl(img.ThumbnailUrl, "X3"),
    caption: img.Caption || img.Title || "",
    takenAt: img.DateTimeOriginal ?? img.Date ?? null,
    width: img.OriginalWidth ?? 4,
    height: img.OriginalHeight ?? 3,
  };
}

async function sourcePhotos(source: PhotoSource): Promise<Photo[]> {
  const node = (await smug<{ Node: Node }>(`/node/${source.nodeId}`)).Node;
  const albums = await albumsUnder(node, source.directOnly);
  let images = (await Promise.all(albums.map((a) => albumImages(a.albumUri))))
    .flat()
    .filter((i) => !i.IsVideo);
  if (source.keyword) {
    const k = source.keyword.toLowerCase();
    images = images.filter((i) =>
      (i.KeywordArray ?? i.Keywords?.split(/[;,]/) ?? []).some((w) => w.trim().toLowerCase() === k),
    );
  }
  if (source.newest) {
    images.sort((a, b) =>
      (b.DateTimeOriginal ?? b.Date ?? "").localeCompare(a.DateTimeOriginal ?? a.Date ?? ""),
    );
    images = images.slice(0, source.newest);
  }
  return images.map(toPhoto);
}

// Photo list for the mosaic, refreshed hourly (FR-23). If a source disappears, the last list stays.
export async function getPhotos(): Promise<{ photos: Photo[]; failed: boolean }> {
  const { photoSources } = await getHousehold();
  const key = `photos:${photoSources.map((s) => `${s.nodeId}/${s.directOnly}/${s.keyword ?? ""}/${s.newest ?? ""}`).join("|")}`;
  const cached = await getCache<Photo[]>(key);
  if (cached?.fresh) return { photos: cached.value, failed: false };
  if (!photoSources.length) return { photos: [], failed: false };
  try {
    const lists = await Promise.all(photoSources.map(sourcePhotos));
    const seen = new Set<string>();
    const photos = lists.flat().filter((p) => !seen.has(p.key) && seen.add(p.key));
    await setCache(key, photos, 3600);
    return { photos, failed: false };
  } catch (err) {
    console.error("smugmug", err);
    return { photos: cached?.value ?? [], failed: true };
  }
}
