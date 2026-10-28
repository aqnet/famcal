// The app's public origin for absolute URLs (OAuth redirect URI, email links, redirects). Behind
// Cloud Run's front end the request can carry the container's own address, so production sets
// APP_ORIGIN; development falls back to what the request says (localhost or a LAN IP).
export function appOrigin(fallback: string): string {
  const configured = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  return configured || fallback;
}
