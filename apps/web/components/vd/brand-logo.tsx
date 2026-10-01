"use client";

/**
 * BrandLogo (task 018): the self-hosted 256px product logo served from
 * /brand/veladesk-logo.png — no CDN, aspect ratio locked (1:1). Rendered at
 * 64–96 CSS px on the startup/loading path and ~28–36 px in the Settings
 * Center header. Deliberately NOT rendered on the ready desktop, rail,
 * dock, wallpaper or as a watermark (see task 018 contract).
 */
export function BrandLogo({
  size = 64,
  className,
  alt = "VelaDesk",
}: {
  /** Rendered square edge in CSS pixels. */
  readonly size: number;
  readonly className?: string;
  readonly alt?: string;
}) {
  return (
    // Self-hosted static asset with explicit intrinsic size — an optimizer
    // pass would add nothing over the already-final PNG.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/veladesk-logo.png"
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
