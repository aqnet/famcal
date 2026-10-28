import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FamCal",
    short_name: "FamCal",
    start_url: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: "#F7F6F2",
    theme_color: "#F7F6F2",
    // The full mark for installs; the tab favicon (app/icon.svg) is a simplified version.
    icons: [
      { src: "/famcal-mark.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
