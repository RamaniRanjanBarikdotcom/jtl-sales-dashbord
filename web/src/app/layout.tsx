import type { Metadata } from "next";
import { AuthWrapper } from "@/components/layout/AuthWrapper";
import QueryProvider from "@/components/providers/QueryProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "JTL Analytics Dashboard",
  description: "Sales Intelligence Platform for JTL-Wawi",
};

// NOTE: We do NOT export `viewport` here. Next.js 16's MetadataWrapper/
// __next_viewport_boundary__ produces hidden={null} (server) vs hidden={true}
// (client) when the viewport export is used — a known webpack-mode bug.
// Instead we inject the viewport meta tag directly so Next.js never creates
// that boundary div, eliminating the hydration mismatch entirely.

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        {/* Viewport injected directly — bypasses Next.js MetadataWrapper boundary */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500&family=Outfit:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet" />
      </head>
      <body suppressHydrationWarning>
        <QueryProvider>
          <AuthWrapper>
            {children}
          </AuthWrapper>
        </QueryProvider>
      </body>
    </html>
  );
}
