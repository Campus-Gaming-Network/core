import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import {
  FieldError,
  fieldErrorProps
} from "../../components/enhanced-mutation";
import type { SupportFieldErrors } from "./contracts";
import { submitSupportTicket } from "./support.functions";

const emptyErrors: SupportFieldErrors = {};

export function SupportTicketForm({
  initialStatus
}: {
  initialStatus?: "failed" | "submitted";
}) {
  const runSubmission = useServerFn(submitSupportTicket);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    status: "idle" | "success" | "error";
    message: string;
    fieldErrors: SupportFieldErrors;
  }>({ status: "idle", message: "", fieldErrors: emptyErrors });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult({ status: "idle", message: "", fieldErrors: emptyErrors });
    try {
      const next = await runSubmission({ data: new FormData(event.currentTarget) });
      setResult({
        status: next.status,
        message: next.message,
        fieldErrors: next.status === "error" ? next.fieldErrors ?? emptyErrors : emptyErrors
      });
    } catch {
      setResult({
        status: "error",
        message: "We could not submit that support ticket. Please try again.",
        fieldErrors: emptyErrors
      });
    } finally {
      setPending(false);
    }
  }

  const initialMessage = initialStatus === "submitted"
    ? "Support ticket submitted. We will review it soon."
    : initialStatus === "failed"
      ? "We could not submit that support ticket. Please try again."
      : "";
  const status = result.message
    ? result.status
    : initialStatus === "submitted"
      ? "success"
      : initialStatus === "failed"
        ? "error"
        : "idle";

  return (
    <form
      action={submitSupportTicket.url}
      className="form-stack"
      method="post"
      onSubmit={submit}
    >
      {result.message || initialMessage ? (
        <p
          aria-live="polite"
          role={status === "error" ? "alert" : "status"}
        >
          {result.message || initialMessage}
        </p>
      ) : null}

      <label>
        Email
        <input
          name="contact_email"
          type="email"
          autoComplete="email"
          required
          {...fieldErrorProps(
            result.fieldErrors.contact_email,
            "contact_email-error"
          )}
        />
        <FieldError
          id="contact_email-error"
          messages={result.fieldErrors.contact_email}
        />
      </label>
      <label>
        Name
        <input
          name="name"
          autoComplete="name"
          maxLength={120}
          {...fieldErrorProps(result.fieldErrors.name, "name-error")}
        />
        <FieldError id="name-error" messages={result.fieldErrors.name} />
      </label>
      <label>
        Subject
        <input
          name="subject"
          required
          maxLength={160}
          {...fieldErrorProps(result.fieldErrors.subject, "subject-error")}
        />
        <FieldError
          id="subject-error"
          messages={result.fieldErrors.subject}
        />
      </label>
      <label>
        Message
        <textarea
          name="message"
          required
          maxLength={5000}
          rows={7}
          {...fieldErrorProps(result.fieldErrors.message, "message-error")}
        />
        <FieldError
          id="message-error"
          messages={result.fieldErrors.message}
        />
      </label>
      <p className="form-help">
        Support tickets are queued for review. Do not include passwords,
        payment card details, or other sensitive secrets.
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit support ticket"}
      </button>
    </form>
  );
}
