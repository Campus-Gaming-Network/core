import Link from "next/link";

type PaginationNavProps = {
  previousHref?: string;
  nextHref?: string;
  label?: string;
};

export function PaginationNav({
  previousHref,
  nextHref,
  label
}: PaginationNavProps) {
  if (!previousHref && !nextHref) {
    return null;
  }

  return (
    <nav aria-label="Pagination" className="pagination">
      {previousHref ? (
        <Link className="button" href={previousHref} rel="prev">
          Previous
        </Link>
      ) : (
        <span aria-disabled="true" className="button pagination__disabled">
          Previous
        </span>
      )}
      {label ? <span className="pagination__label">{label}</span> : null}
      {nextHref ? (
        <Link className="button" href={nextHref} rel="next">
          Next
        </Link>
      ) : (
        <span aria-disabled="true" className="button pagination__disabled">
          Next
        </span>
      )}
    </nav>
  );
}
