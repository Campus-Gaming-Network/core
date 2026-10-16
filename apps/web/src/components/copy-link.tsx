import { useHydrated } from "@tanstack/react-router";
import { Check, Copy, Share2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

const copiedMessage = "Link copied to the clipboard";
const failedMessage =
  "Could not copy. The link is selected: press Ctrl+C or Cmd+C.";

/**
 * A link shown as selectable text with a "Copy link" button, and a "Share"
 * button where the device has a native share sheet. Without JavaScript the
 * text is still there to select; the buttons only appear once the page is
 * interactive, since they have nothing to do before then.
 */
export function CopyLink({
  label,
  shareTitle,
  url,
}: {
  label: string;
  /** What the native share sheet calls the link; leave out to hide Share. */
  shareTitle?: string;
  url: string;
}) {
  const inputID = useId();
  const input = useRef<HTMLInputElement>(null);
  const interactive = useHydrated();
  const [canShare, setCanShare] = useState(false);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  // Feature-detect after hydration so the server and first client render match.
  useEffect(() => {
    setCanShare(
      shareTitle !== undefined &&
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function",
    );
  }, [shareTitle]);

  useEffect(() => {
    if (status !== "copied") return;
    const reset = setTimeout(() => setStatus("idle"), 4000);
    return () => clearTimeout(reset);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      // Clipboard access needs a secure context and permission. Select the
      // text and try the older copy command before asking the viewer to.
      input.current?.select();
      setStatus(document.execCommand("copy") ? "copied" : "failed");
    }
  }

  async function share() {
    try {
      await navigator.share({ title: shareTitle, url });
    } catch (error) {
      // Closing the sheet is a choice, not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copy();
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
        <div className="copy-link__actions">
          {canShare ? (
            <button
              className="button--primary copy-link__button"
              onClick={share}
              type="button"
            >
              <Share2 aria-hidden="true" size={16} strokeWidth={1.75} />
              Share
            </button>
          ) : null}
          <button
            className={`copy-link__button${canShare ? " button--secondary" : ""}`}
            onClick={copy}
            type="button"
          >
            {status === "copied" ? (
              <Check aria-hidden="true" size={16} strokeWidth={1.75} />
            ) : (
              <Copy aria-hidden="true" size={16} strokeWidth={1.75} />
            )}
            {status === "copied" ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}
      <p
        className={`copy-link__status${status === "idle" ? "" : ` is-${status}`}`}
        role="status"
      >
        {status === "copied"
          ? copiedMessage
          : status === "failed"
            ? failedMessage
            : ""}
      </p>
    </div>
  );
}
