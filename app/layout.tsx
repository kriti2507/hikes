import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "日本百名山 · Hyakumeizan Checklist",
  description: "A shared checklist for the 100 Famous Mountains of Japan.",
};

export const viewport: Viewport = {
  // Match the washi paper so mobile browser chrome blends into the page. The
  // theme is a stored choice rather than an OS preference now, so there is one
  // colour here — the daylight default.
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7eed9",
};

// Runs before first paint, so a reader who chose night does not get a flash of
// the daylight print first. Kept inline and tiny for that reason — anything
// imported would arrive too late.
const RESTORE_THEME = `try{if(localStorage.getItem('hyakumeizan-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The inline script writes `data-theme` before React hydrates, which would
    // otherwise be reported as an attribute mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: RESTORE_THEME }} />
      </head>
      <body>
        {/* The banner print is a CSS background, so it is not discoverable by
            the preload scanner. Light is the default, so that is the one worth
            preloading; the night print loads when it is switched on. */}
        <link rel="preload" as="image" href="/red-fuji.jpg" />
        {children}
      </body>
    </html>
  );
}
