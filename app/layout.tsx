import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pinefrost Analytics | Performance Dashboard",
  description: "Pinefrost Analytics — performance intelligence for Pinefrost Distribution.",
  applicationName: "Pinefrost Analytics",
  themeColor: "#0b3d35",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}
