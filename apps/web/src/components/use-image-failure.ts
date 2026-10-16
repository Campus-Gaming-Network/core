import { useEffect, useRef, useState } from "react";

/**
 * Tracks whether the image at `src` failed to load. Spread `ref` and `onError`
 * onto the `<img>`. An image can fail before hydration installs the error
 * handler, so the effect also checks the element once mounted. A new `src`
 * starts fresh.
 */
export function useImageFailure(src: string | undefined) {
  const ref = useRef<HTMLImageElement>(null);
  const [failedSrc, setFailedSrc] = useState<string>();
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth === 0)
      setFailedSrc(src);
  }, [src]);
  return {
    failed: !src || failedSrc === src,
    onError: () => setFailedSrc(src),
    ref,
  };
}
