import type { Metadata, Viewport } from "next";
import { ClerkProvider } from '@clerk/nextjs';
import { productBrand } from '@/lib/brand';
import "./globals.css";

export const metadata: Metadata = {
  title: `${productBrand.name} - AI Cofounder Workspace`,
  description: `${productBrand.name} connects AI teammates with your work context and decision preferences.`,
  icons: {
    icon: [
      { url: '/brand/minaco/minaco-favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/minaco/png/minaco-favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/minaco/png/minaco-favicon-64.png', sizes: '64x64', type: 'image/png' },
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
        <body className="min-h-full bg-[#090a0a]">{children}</body>
      </html>
    </ClerkProvider>
  );
}
