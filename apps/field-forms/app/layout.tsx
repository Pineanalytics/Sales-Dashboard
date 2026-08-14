import type { Metadata, Viewport } from "next";
import "./globals.css";
import Header from "@/components/Header";
import RegisterSW from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "Pineapps",
  description: "Pinefrost Limited's field data collection, coaching, and asset management platform",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pineapps",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0A1F52",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body
        className="min-h-full flex flex-col"
        style={{
          // Distinctive but network-independent type stack:
          // a grounded slab/sans pairing rather than a Google Fonts import.
          ['--font-display' as any]:
            '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
          ['--font-body' as any]:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          ['--font-mono' as any]:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}
      >
        <Header />
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
