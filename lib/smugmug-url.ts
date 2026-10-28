export type ParsedSmugMugUrl = { owner: string; path: string; nodeId: string | null };

// https://<owner>.smugmug.com/<folder>/<gallery>/n-<nodeId> → owner, path, node ID (FR-27).
export function parseSmugMugUrl(input: string): ParsedSmugMugUrl | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !host.endsWith(".smugmug.com")) return null;
  const owner = host.slice(0, -".smugmug.com".length);
  if (!owner || owner === "www" || owner === "api" || owner === "secure" || owner.includes(".")) return null;

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const nodeSeg = segments.find((s) => /^n-[A-Za-z0-9]+$/.test(s));
  const pathSegs = segments.filter((s) => s !== nodeSeg && !/^[a-z]-[A-Za-z0-9]+$/.test(s));
  return { owner, path: "/" + pathSegs.join("/"), nodeId: nodeSeg ? nodeSeg.slice(2) : null };
}

// SmugMug serves each size at a predictable URL: swap the size code in the thumbnail URL.
export type SmugSize = "S" | "M" | "L" | "XL" | "X2" | "X3";

export function sizedUrl(thumbnailUrl: string, size: SmugSize): string {
  return thumbnailUrl.replace(/\/Th\/([^/]*)-Th\.(\w+)$/, `/${size}/$1-${size}.$2`);
}
