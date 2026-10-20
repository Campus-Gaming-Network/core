import { SchoolLogo } from "./school-logo.js";
import { schoolMonogram, schoolTone } from "./school-identity.js";

/**
 * A school's tile: its logo on white, or, with no logo or a failed one, its
 * monogram on the school's pale tone. Beside the school's name it is
 * decorative. Size and spacing come from `className` (styles.css and the
 * feature sheets); `size` is the logo image's width and height.
 */
export function SchoolMark({
  className,
  logoURL,
  name,
  size,
  slug,
}: {
  className?: string;
  logoURL?: string;
  name: string;
  size: number;
  slug: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={
        className
          ? `school-directory-mark ${className}`
          : "school-directory-mark"
      }
      data-school-tone={schoolTone(slug)}
    >
      {schoolMonogram(name)}
      <SchoolLogo logoURL={logoURL} size={size} />
    </span>
  );
}
