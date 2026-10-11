import { useEffect, useRef, useState } from "react";

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
}: {
  logoURL?: string;
  alt?: string;
  size: number;
  /** Sits on the text line, in front of the school's name. */
  inline?: boolean;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [failedURL, setFailedURL] = useState<string>();
  useEffect(() => {
    // An image can fail before hydration installs its error handler.
    if (image.current?.complete && image.current.naturalWidth === 0)
      setFailedURL(logoURL);
  }, [logoURL]);
  if (!logoURL || failedURL === logoURL) return null;
  return (
    <img
      alt={alt}
      className={inline ? "school-logo school-logo--inline" : "school-logo"}
      decoding="async"
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      ref={image}
      onError={() => setFailedURL(logoURL)}
      src={logoURL}
      width={size}
    />
  );
}
