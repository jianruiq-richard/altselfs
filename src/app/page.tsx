import type { Metadata, Viewport } from "next";
import { AstromarLandingPage } from "@/components/astromar-landing-page";
import { productBrand } from "@/lib/brand";

const homepageDescription =
  `${productBrand.name} is an AI cofounder workspace for competitor intelligence—estimate revenue and user counts, and uncover customer acquisition and marketing tactics.`;

export const metadata: Metadata = {
  title: `${productBrand.name} | Your AI cofounder`,
  description: homepageDescription,
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  themeColor: "#090909",
};

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

export default function Home() {
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
