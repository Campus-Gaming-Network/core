import { useHydrated } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";

/**
 * A password input with a button that shows what was typed. Use it for the
 * shared team and event passwords, which people often need to check before
 * passing them on. Without JavaScript the field is a plain password input;
 * the button only appears once the page is interactive, since it has nothing
 * to do before then. Toggling changes the type of the same input, so the
 * value and focus stay where they were.
 */
export function PasswordInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">,
) {
  const interactive = useHydrated();
  const [revealed, setRevealed] = useState(false);
  const Icon = revealed ? EyeOff : Eye;

  return (
    <span className="password-input">
      <input {...props} type={revealed ? "text" : "password"} />
      {interactive ? (
        <button
          className="password-input__toggle"
          onClick={() => setRevealed((current) => !current)}
          type="button"
        >
          <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
          {revealed ? "Hide password" : "Show password"}
        </button>
      ) : null}
    </span>
  );
}
