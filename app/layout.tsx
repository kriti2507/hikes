import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "日本百名山 · Hyakumeizan Checklist",
  description: "A shared checklist for the 100 Famous Mountains of Japan.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Match the washi paper so mobile browser chrome blends into the page.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1e7d2" },
    { media: "(prefers-color-scheme: dark)", color: "#14120f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* The banner print is a CSS background, so it is not discoverable by the
            preload scanner. Only the scheme-matched one is fetched. */}
        <link rel="preload" as="image" href="/red-fuji.jpg" media="(prefers-color-scheme: light)" />
        <link rel="preload" as="image" href="/black-fuji.jpg" media="(prefers-color-scheme: dark)" />
        {children}
      </body>
    </html>
  );
}
