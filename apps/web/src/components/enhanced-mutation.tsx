import { useRouter } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { FormFieldErrors } from "../features/event-slice/contracts";

type EnhancedMutationResult =
  | { status: "success"; redirectTo: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: FormFieldErrors;
    };

type MutationFeedback = {
  message: string;
  fieldErrors: FormFieldErrors;
};

const emptyFeedback: MutationFeedback = {
  message: "",
  fieldErrors: {},
};

export function useEnhancedMutation(fallbackMessage: string) {
  const router = useRouter();
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<MutationFeedback>(emptyFeedback);
  const submittedForm = useRef<HTMLFormElement | null>(null);

  // Safari does not focus a button when it is clicked, so the focused element
  // cannot be relied on to find the form. The capturing listener runs before
  // React's submit handler, which is what calls `execute`.
  useEffect(() => {
    const remember = (event: Event) => {
      if (event.target instanceof HTMLFormElement)
        submittedForm.current = event.target;
    };
    document.addEventListener("submit", remember, true);
    return () => document.removeEventListener("submit", remember, true);
  }, []);

  useEffect(() => {
    if (feedback.message) {
      errorSummaryRef.current?.focus();
    }
  }, [feedback]);

  async function execute(request: () => Promise<EnhancedMutationResult>) {
    // The submitted form is the one to mark busy; CSS draws the spinner in
    // its submit button and the unsaved-changes guard waits for it.
    const form =
      submittedForm.current ?? document.activeElement?.closest("form") ?? null;
    form?.setAttribute("aria-busy", "true");
    setPending(true);
    setFeedback(emptyFeedback);

    try {
      const result = await request();
      if (result.status === "error") {
        setFeedback({
          message: result.message,
          fieldErrors: result.fieldErrors ?? {},
        });
        return;
      }

      await router.invalidate();
      await router.navigate({ href: result.redirectTo, replace: true });
    } catch {
      setFeedback({ message: fallbackMessage, fieldErrors: {} });
    } finally {
      form?.removeAttribute("aria-busy");
      setPending(false);
    }
  }

  return {
    execute,
    errorSummaryRef,
    fieldErrors: feedback.fieldErrors,
    message: feedback.message,
    pending,
  };
}

export function FormErrorSummary({
  fieldErrors,
  fieldIds = {},
  message,
  summaryRef,
}: {
  fieldErrors: FormFieldErrors;
  fieldIds?: Record<string, string>;
  message: string;
  summaryRef: RefObject<HTMLDivElement | null>;
}) {
  const titleId = useId();
  if (!message) return null;

  const errors = Object.entries(fieldErrors).flatMap(([field, messages]) =>
    (messages ?? []).map((fieldMessage) => ({
      field,
      fieldMessage,
      target: fieldIds[field],
    })),
  );

  return (
    <div
      aria-labelledby={titleId}
      className="form-error-summary"
      ref={summaryRef}
      role="alert"
      tabIndex={-1}
    >
      <h2 id={titleId}>There is a problem</h2>
      {errors.length === 0 ? <p>{message}</p> : null}
      {errors.length > 0 ? (
        <ul>
          {errors.map(({ field, fieldMessage, target }, index) => (
            <li key={`${field}-${index}`}>
              {target ? (
                <a
                  href={`#${target}`}
                  onClick={(event) => {
                    const control = document.querySelector<HTMLElement>(
                      `[aria-describedby~="${target}"]`,
                    );
                    if (control) {
                      event.preventDefault();
                      control.focus();
                    }
                  }}
                >
                  {fieldMessage}
                </a>
              ) : (
                fieldMessage
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function FieldError({
  id,
  messages,
}: {
  id: string;
  messages?: string[];
}) {
  if (!messages || messages.length === 0) {
    return null;
  }

  return (
    <p className="form-error" id={id}>
      {messages.join(" ")}
    </p>
  );
}

export function fieldErrorProps(messages: string[] | undefined, id: string) {
  const invalid = Boolean(messages?.length);

  return {
    "aria-describedby": invalid ? id : undefined,
    "aria-invalid": invalid || undefined,
  };
}
