import type { Metadata } from "next";
import { ClerkProvider } from '@clerk/nextjs';
import { Analytics } from '@vercel/analytics/next';
import "./globals.css";

export const metadata: Metadata = {
  title: "OPC平台 - 数字分身工作台",
  description: "统一的 OPC 数字分身协作平台",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="zh-CN" className="h-full antialiased">
        <body className="min-h-full">
          {children}
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
