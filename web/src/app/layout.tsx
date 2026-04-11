import type { Metadata, Viewport } from "next";
import { AuthWrapper } from "@/components/layout/AuthWrapper";
import QueryProvider from "@/components/providers/QueryProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "JTL Analytics Dashboard",
  description: "Sales Intelligence Platform for JTL-Wawi",
};

// Explicit viewport export prevents Next.js hydration mismatch on the
// internal MetadataWrapper/viewport-boundary div (hidden=null vs hidden=true).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
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
