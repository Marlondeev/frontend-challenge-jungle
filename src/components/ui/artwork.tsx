import type { ImgHTMLAttributes } from "react";
import type { Artwork } from "@/domain/types";
import { cn } from "@/lib/utils";
interface Props extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "size"
> {
  artwork: Artwork;
  size?: "hero" | "card" | "thumb";
  eager?: boolean;
}
export function ArtworkImage({
  artwork,
  size = "card",
  eager = false,
  className,
  alt,
  ...props
}: Props) {
  const base = `/assets/artwork/${artwork}`;
  return (
    <img
      src={`${base}-${size === "thumb" ? 96 : 640}.webp`}
      srcSet={
        size === "thumb"
          ? undefined
          : `${base}-320.webp 320w, ${base}-640.webp 640w, ${base}-960.webp 960w`
      }
      sizes={
        size === "hero"
          ? "(min-width: 1200px) 450px, (min-width: 768px) 40vw, calc(100vw - 56px)"
          : "(min-width: 1200px) 260px, (min-width: 768px) 30vw, calc((100vw - 84px) / 2)"
      }
      width={size === "thumb" ? 96 : 640}
      height={size === "thumb" ? 96 : 640}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      className={cn("artwork-image", className)}
      alt={alt ?? "Arte digital colecionável Kurio"}
      {...props}
    />
  );
}
