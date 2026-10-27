import { useEffect, useRef, useState } from "react";
import {
  characterCountMessage,
  serverTextSize,
} from "./character-count-logic.js";

const announceDelayMilliseconds = 1000;

/**
 * GOV.UK-style character count for the control in the same label. Rendered on
 * the server (and without JavaScript) it states the limit; once hydrated it
 * follows the control as the person types. The visible hint is the control's
 * description and is not live, so screen readers are not interrupted per
 * keystroke; a separate polite region repeats it after typing pauses.
 */
export function CharacterCount({
  hintId,
  limit,
}: {
  hintId: string;
  limit: number;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const control = anchor.current
      ?.closest("label")
      ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea",
      );
    if (!control) return;
    const multiline = control instanceof HTMLTextAreaElement;
    const measure = () => serverTextSize(control.value, multiline);
    setSize(measure());

    let timer: number | undefined;
    const onInput = () => {
      const next = measure();
      setSize(next);
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => setAnnouncement(characterCountMessage(limit, next).text),
        announceDelayMilliseconds,
      );
    };
    control.addEventListener("input", onInput);
    return () => {
      window.clearTimeout(timer);
      control.removeEventListener("input", onInput);
    };
  }, [limit]);

  const message = characterCountMessage(limit, size);
  return (
    <span className="character-count" ref={anchor}>
      <span
        className={
          message.over
            ? "character-count__hint character-count__hint--over"
            : "character-count__hint"
        }
        id={hintId}
      >
        {message.text}
      </span>
      <span aria-live="polite" className="visually-hidden">
        {announcement}
      </span>
    </span>
  );
}
