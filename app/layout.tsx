import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pinefrost Limited Performance Dashboard",
  description: "Kenya distributor sales analytics — revenue, coverage, profitability, stock and forecasts by principal.",
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
