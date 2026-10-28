import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { unoptimized: true },
  // Lets other devices on the LAN (the wall display, phones) use `next dev` at this machine's IP;
  // without it Next blocks dev assets and client pages like /settings never hydrate. Set
  // DEV_ORIGINS in .env.local (comma-separated hosts) so the address stays out of the public repo.
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "").split(",").filter(Boolean),
  // Shown at the bottom of every screen; bump "version" in package.json to change it.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
};

export default nextConfig;
