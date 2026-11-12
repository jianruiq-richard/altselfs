import { websiteIcons } from '@/lib/brand-icons';
import type { Metadata, Viewport } from "next";
import { ClerkProvider } from '@clerk/nextjs';
import { Analytics } from '@vercel/analytics/next';
import { GoogleAnalytics } from '@/components/google-analytics';
import { GoogleAnalyticsScripts } from '@/components/google-analytics-scripts';
import { MicrosoftClarityScripts } from '@/components/microsoft-clarity-scripts';
import { productBrand } from '@/lib/brand';
import "./globals.css";
import { AuthModalProvider } from "@/components/auth-modal-provider";

export const metadata: Metadata = {
  metadataBase: new URL(productBrand.canonicalUrl),
  title: `${productBrand.name} — All your AI agents. One subscription.`,
  description: `${productBrand.name} brings your AI agents, tools, and connected apps together in one desktop workspace.`,
  openGraph: { siteName: 'Minaco', type: 'website', images: [{ url: '/landing/og-minaco.png', width: 1200, height: 630, alt: 'Minaco — All your AI agents. One subscription.' }] },
  twitter: { card: 'summary_large_image', images: ['/landing/og-minaco.png'] },
  icons: websiteIcons,
};

export const viewport: Viewport = {
  themeColor: '#090a0a',
  interactiveWidget: 'resizes-visual',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en-US" className="h-full antialiased">
        <body className="min-h-full bg-[#090a0a]">
          <GoogleAnalyticsScripts />
          <MicrosoftClarityScripts />
          <AuthModalProvider>{children}</AuthModalProvider>
          <GoogleAnalytics />
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
