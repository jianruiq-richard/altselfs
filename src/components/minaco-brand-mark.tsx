import Image from "next/image";
import { productBrand } from "@/lib/brand";

const brandAssetPaths = {
  favicon: "/brand/minaco/minaco-favicon.svg",
  mark: "/brand/minaco/minaco-mark.svg",
  appIcon: "/brand/minaco/minaco-app-icon.svg",
} as const;

type MinacoBrandMarkProps = {
  className?: string;
  imageClassName?: string;
  variant?: keyof typeof brandAssetPaths;
  decorative?: boolean;
};

export function MinacoBrandMark({
  className,
  imageClassName,
  variant = "favicon",
  decorative = true,
}: MinacoBrandMarkProps) {
  return (
    <span className={className} aria-hidden={decorative ? "true" : undefined}>
      <Image
        alt={decorative ? "" : `${productBrand.name} logo`}
        className={imageClassName}
        draggable={false}
        height={64}
        src={brandAssetPaths[variant]}
        unoptimized
        width={64}
      />
    </span>
  );
}
