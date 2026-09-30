/**
 * A school's logo, or nothing while the school has none. Callers pass a
 * `logo_url` the server has already verified against the asset location.
 * Beside the school's name the image is decorative; on its own it needs `alt`.
 */
export function SchoolLogo({
  logoURL,
  alt = "",
  size,
}: {
  logoURL?: string;
  alt?: string;
  size: number;
}) {
  if (!logoURL) return null;
  return (
    <img
      alt={alt}
      className="school-logo"
      decoding="async"
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      src={logoURL}
      width={size}
    />
  );
}
