import type { Metadata, Viewport } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AstromarLandingPage } from "@/components/astromar-landing-page";
import { productBrand } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${productBrand.name} | Your AI cofounder`,
  description:
    `${productBrand.name} helps founders track competitor moves, find seed users, and turn ideas into shippable first versions with an AI cofounder.`,
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
