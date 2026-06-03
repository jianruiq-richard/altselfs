import type { Metadata, Viewport } from "next";
import { ClerkProvider } from '@clerk/nextjs';
import "./globals.css";

export const metadata: Metadata = {
  title: "Altselfs - 每个人的 Decision OS",
  description: "Altselfs 为高能个体构建 AI 决策分身，聚合跨平台工作 context，沉淀个人决策偏好。",
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
      <html lang="zh-CN" className="h-full antialiased">
        <body className="min-h-full bg-gray-50">{children}</body>
      </html>
    </ClerkProvider>
  );
}
