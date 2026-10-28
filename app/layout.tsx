import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

// next/font self-hosts Manrope at build time, so it renders offline (visualdesign.md → Typography).
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap" });

export const metadata: Metadata = {
  title: "Family Calendar",
  description: "The family's week, weather and photos on the kitchen iPad.",
  appleWebApp: { capable: true, title: "Family Calendar", statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false, date: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F6F2" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={manrope.className}>
      <body>
        {children}
        {/* Positioned inline so it stays out of the page flow (no overscroll) even with stale CSS. */}
        <span
          className="app-version"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 4,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          v{process.env.NEXT_PUBLIC_APP_VERSION}
        </span>
      </body>
    </html>
  );
}
