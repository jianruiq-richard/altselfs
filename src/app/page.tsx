import type { Metadata, Viewport } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AstromarLandingPage } from "@/components/astromar-landing-page";

export const metadata: Metadata = {
  title: "Astromar | Your AI cofounder",
  description:
    "Astromar helps founders track competitor moves, find seed users, and turn ideas into shippable first versions with an AI cofounder.",
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
