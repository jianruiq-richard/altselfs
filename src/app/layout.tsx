import type { Metadata, Viewport } from "next";
import { ClerkProvider } from '@clerk/nextjs';
import { GoogleAnalytics } from '@/components/google-analytics';
import { GoogleAnalyticsScripts } from '@/components/google-analytics-scripts';
import { MicrosoftClarityScripts } from '@/components/microsoft-clarity-scripts';
import { productBrand } from '@/lib/brand';
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(productBrand.canonicalUrl),
  title: `${productBrand.name} - AI Cofounder Workspace`,
  description: `${productBrand.name} connects AI teammates with your work context and decision preferences.`,
  icons: {
    icon: [
      { url: '/brand/minaco/png/minaco-favicon-96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: [
      { url: '/brand/minaco/png/minaco-apple-touch-icon-180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
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
          {children}
          <GoogleAnalytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
