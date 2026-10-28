import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Calendar",
    short_name: "Calendar",
    start_url: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: "#F7F6F2",
    theme_color: "#F7F6F2",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
