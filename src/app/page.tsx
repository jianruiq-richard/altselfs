import type { Metadata, Viewport } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AstromarLandingPage } from "@/components/astromar-landing-page";

export const metadata: Metadata = {
  title: "Astromar | Your AI cofounder",
  description:
    "Astromar is your AI cofounder, built to think with you, act for you, and turn fragmented context into sharper startup decisions.",
};

export const viewport: Viewport = {
  themeColor: "#090909",
};

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }

  return <AstromarLandingPage />;
}
