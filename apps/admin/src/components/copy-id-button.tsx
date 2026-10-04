import { useState, type ReactNode } from "react";

/** Copies a record's ID, which the console never displays. */
export function CopyIdButton({
  entity,
  id,
}: {
  entity: string;
  id: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="copy-id"
      onClick={() => {
        void navigator.clipboard.writeText(id).then(() => setCopied(true));
      }}
      onBlur={() => setCopied(false)}
      type="button"
    >
      {copied ? "Copied" : `Copy ${entity} ID`}
    </button>
  );
}
