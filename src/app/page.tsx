import type { Metadata, Viewport } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AstromarLandingPage } from "@/components/astromar-landing-page";
import { productBrand } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${productBrand.name} | Your AI cofounder`,
  description:
    `${productBrand.name} is an AI cofounder workspace that helps founders analyze startup context, connected work data, and market signals to make clearer decisions.`,
};

export const viewport: Viewport = {
  themeColor: "#090909",
};

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/investor/chat/100");
  }

  return <AstromarLandingPage />;
}
