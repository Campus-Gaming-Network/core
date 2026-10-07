import { useHydrated } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

const copiedMessage = "Link copied";
const failedMessage = "Press Ctrl+C or Cmd+C to copy the selected link";

/**
 * A link shown as selectable text with a "Copy link" button. Without
 * JavaScript the text is still there to select; the button only appears once
 * the page is interactive, since it has nothing to do before then.
 */
export function CopyLink({ label, url }: { label: string; url: string }) {
  const inputID = useId();
  const input = useRef<HTMLInputElement>(null);
  const interactive = useHydrated();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (status !== "copied") return;
    const reset = setTimeout(() => setStatus("idle"), 2500);
    return () => clearTimeout(reset);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      // Clipboard access needs a secure context and permission; fall back to
      // selecting the text so the viewer can copy it themselves.
      input.current?.select();
      setStatus("failed");
    }
  }

  return (
    <div className="copy-link">
      <label htmlFor={inputID}>{label}</label>
      <input
        className="copy-link__url"
        id={inputID}
        onFocus={(event) => event.currentTarget.select()}
        readOnly
        ref={input}
        value={url}
      />
      {interactive ? (
        <button className="copy-link__button" onClick={copy} type="button">
          {status === "copied" ? (
            <Check aria-hidden="true" size={16} strokeWidth={1.75} />
          ) : (
            <Copy aria-hidden="true" size={16} strokeWidth={1.75} />
          )}
          {status === "copied" ? "Copied" : "Copy link"}
        </button>
      ) : null}
      <p className="visually-hidden" role="status">
        {status === "copied"
          ? copiedMessage
          : status === "failed"
            ? failedMessage
            : ""}
      </p>
    </div>
  );
}
