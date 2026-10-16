import { Fragment } from "react";

/**
 * An event's time range (from `eventTimeRange`) that only breaks between its
 * date, start, and end. Each piece stays whole, so a time never splits from its
 * AM/PM or zone ("11:45 PM CDT" moves as one).
 */
export function EventTimeText({ range }: { range: string }) {
  const pieces = range.split(/(, | – )/);
  return (
    <>
      {pieces.map((piece, index) => (
        <Fragment key={index}>
          {index % 2 === 1 ? piece : <span className="nowrap">{piece}</span>}
        </Fragment>
      ))}
    </>
  );
}
