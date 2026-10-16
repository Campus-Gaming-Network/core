import { useImageFailure } from "./use-image-failure";

/**
 * A verified school logo. Missing or failed images reveal the caller's initial.
 * Callers pass a local bundle path or an approved admin asset URL from the BFF.
 * Beside the school's name the image is decorative; on its own it needs `alt`.
 */
export function SchoolLogo({
  logoURL,
  alt = "",
  size,
  inline = false,
  eager = false,
}: {
  logoURL?: string;
  alt?: string;
  size: number;
  /** Sits on the text line, in front of the school's name. */
  inline?: boolean;
  /** Above the fold: load now instead of waiting to scroll near. */
  eager?: boolean;
}) {
  const { failed, onError, ref } = useImageFailure(logoURL);
  if (!logoURL || failed) return null;
  return (
    <img
      alt={alt}
      className={inline ? "school-logo school-logo--inline" : "school-logo"}
      decoding="async"
      height={size}
      loading={eager ? "eager" : "lazy"}
      referrerPolicy="no-referrer"
      ref={ref}
      onError={onError}
      src={logoURL}
      width={size}
    />
  );
}
