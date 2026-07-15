import type { Metadata, Viewport } from "next";
import { ClerkProvider } from '@clerk/nextjs';
import "./globals.css";

export const metadata: Metadata = {
  title: "Altselfs - Decision OS",
  description: "Altselfs connects AI teammates with your work context and personal decision preferences.",
};

export const viewport: Viewport = {
  themeColor: '#f9fafb',
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
        <body className="min-h-full bg-gray-50">{children}</body>
      </html>
    </ClerkProvider>
  );
}
