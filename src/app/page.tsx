import type { Metadata, Viewport } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AstromarLandingPage } from "@/components/astromar-landing-page";
import { productBrand } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${productBrand.name} | Your AI cofounder`,
  description:
    `${productBrand.name} is an AI cofounder workspace that helps founders analyze startup context, connected work data, and market signals to make clearer decisions.`,
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  themeColor: "#090909",
};

const homepageDescription =
  `${productBrand.name} is an AI cofounder workspace that helps founders track competitor moves, find seed users, and turn ideas into shippable first versions.`;

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: productBrand.name,
    url: productBrand.canonicalUrl,
    logo: `${productBrand.canonicalUrl}/brand/minaco/png/minaco-app-icon-512.png`,
    description: homepageDescription,
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: productBrand.name,
    alternateName: ["Minaco AI", productBrand.domain],
    url: productBrand.canonicalUrl,
    description: homepageDescription,
  },
];

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/investor/chat/100");
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <AstromarLandingPage />
    </>
  );
}
